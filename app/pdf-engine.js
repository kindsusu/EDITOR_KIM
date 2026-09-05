// PDFium(WASM) 얇은 래퍼 — 열기 / 렌더(PNG) / 객체 목록 / 텍스트 교체 / 저장
// 계약: PLAN.md P2 "엔진 계약" 참고.
const fs = require('fs');
const fontkit = require('fontkit');
const fontRegistry = require('./pdf-fonts');

const MARK_MASK = 'EditorKimMask', MARK_GROUP = 'EditorKimGroup';
const LEGACY = { EditorKimMask: 'DaepilMask', EditorKimGroup: 'DaepilGroup' }; // 옛 이름으로 저장된 파일 호환용 — 읽기 전용

const OBJ_TEXT = 1, OBJ_PATH = 2, OBJ_IMAGE = 3; // FPDF_PAGEOBJ_*
const RENDER_FLAGS = 0x01 | 0x10;                // FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER(=RGBA로 뽑기)
const FPDF_FONT_TRUETYPE = 2;
const LINE_HEIGHT = 1.2; // 줄바꿈 편집 시 행간(글자 크기 배수). PDF는 행간 정보를 주지 않는다

// 폴백 한글 폰트 후보 (윈도우 기준). 없으면 폴백 불가 → setText가 ok:false.
const FALLBACK_FONTS = [
  'C:\\Windows\\Fonts\\malgun.ttf',
  'C:\\Windows\\Fonts\\malgunbd.ttf',
  'C:\\Windows\\Fonts\\NotoSansKR-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
];

// ── 폴백 폰트 서브셋 ───────────────────────────────────────────────────────
// 맑은 고딕 전체(7.5MB)를 FPDFText_LoadFont에 넘기면 PDFium이 서브셋 없이 그대로 임베드한다.
// → 편집에 쓰인 글자만 남긴 TTF를 만들어 넘긴다.
// 라이브러리는 fontkit(순수 JS·동기). subset-font(HarfBuzz wasm)는 cmap까지 챙겨주지만 async라
// 동기 계약인 setText에서 쓸 수 없다.
// fontkit의 TTF 서브셋은 cmap을 만들지 않는다(pdfkit은 글리프 ID로 직접 그려서 필요 없음).
// PDFium은 FPDFText_SetText에서 cmap으로 유니코드→글리프를 찾으므로 cmap이 없으면 전부 두부(□)로 그려진다.
// → format 4 cmap을 직접 만들어 붙인다. (BMP 밖 글자는 format 12가 필요 — 한글에는 안 쓰인다)
const _fkCache = new Map();
function subsetTTF(path, chars) {
  let f = _fkCache.get(path);
  if (!f) { f = fontkit.openSync(path); if (f.fonts) f = f.fonts[0]; _fkCache.set(path, f); }
  const sub = f.createSubset();
  const map = [];
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) continue;              // BMP만
    const g = f.glyphForCodePoint(cp);
    if (!g || !g.id) continue;              // 폰트에 없는 글자 → 넣지 않으면 canRender가 notdef로 잡는다
    map.push([cp, sub.includeGlyph(g.id)]);
  }
  map.sort((a, b) => a[0] - b[0]);
  return addTable(Buffer.from(sub.encode()), 'cmap', cmap4(map));
}

// cmap format 4: 글자 하나당 세그먼트 하나(수십 글자뿐이라 압축할 이유가 없다) + 필수 0xFFFF 종단
function cmap4(pairs) {
  const n = pairs.length + 1, sel = Math.floor(Math.log2(n));
  const b = Buffer.alloc(28 + n * 8);
  b.writeUInt16BE(0, 0); b.writeUInt16BE(1, 2);           // version, numTables
  b.writeUInt16BE(3, 4); b.writeUInt16BE(1, 6);           // platformID 3(Windows), encodingID 1(BMP)
  b.writeUInt32BE(12, 8);                                 // subtable offset
  b.writeUInt16BE(4, 12); b.writeUInt16BE(16 + n * 8, 14); b.writeUInt16BE(0, 16); // format, length, language
  b.writeUInt16BE(n * 2, 18);                             // segCountX2
  b.writeUInt16BE(2 << sel, 20); b.writeUInt16BE(sel, 22); b.writeUInt16BE(n * 2 - (2 << sel), 24);
  const end = 26, start = end + n * 2 + 2, delta = start + n * 2; // idRangeOffset[]은 전부 0
  [...pairs, [0xffff, 0x10000]].forEach(([cp, gid], i) => {
    b.writeUInt16BE(cp, end + i * 2);
    b.writeUInt16BE(cp, start + i * 2);
    b.writeUInt16BE((gid - cp) & 0xffff, delta + i * 2);  // idDelta는 uint16 mod 연산
  });
  return b;
}

const u32 = (b, i) => ((((b[i] || 0) << 24) | ((b[i + 1] || 0) << 16) | ((b[i + 2] || 0) << 8) | (b[i + 3] || 0)) >>> 0);
const checksum = (b) => { let s = 0; for (let i = 0; i < b.length; i += 4) s = (s + u32(b, i)) >>> 0; return s; };

// sfnt에 테이블 하나를 끼워 넣고 디렉터리를 다시 쓴다 (head.checkSumAdjustment는 손대지 않는다 — FreeType이 안 본다)
function addTable(ttf, tag, data) {
  const tables = [{ tag, data }];
  for (let i = 0, p = 12; i < ttf.readUInt16BE(4); i++, p += 16) {
    const off = ttf.readUInt32BE(p + 8), len = ttf.readUInt32BE(p + 12);
    tables.push({ tag: ttf.toString('latin1', p, p + 4), data: ttf.subarray(off, off + len) });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = tables.length, sel = Math.floor(Math.log2(n));
  const dir = Buffer.alloc(12 + n * 16);
  dir.writeUInt32BE(0x00010000, 0); dir.writeUInt16BE(n, 4);
  dir.writeUInt16BE(16 << sel, 6); dir.writeUInt16BE(sel, 8); dir.writeUInt16BE(n * 16 - (16 << sel), 10);
  const parts = [dir];
  let off = dir.length;
  tables.forEach((t, i) => {
    const p = 12 + i * 16, pad = (4 - (t.data.length % 4)) % 4;
    dir.write(t.tag, p, 'latin1');
    dir.writeUInt32BE(checksum(t.data), p + 4);
    dir.writeUInt32BE(off, p + 8);
    dir.writeUInt32BE(t.data.length, p + 12);
    parts.push(t.data);
    if (pad) parts.push(Buffer.alloc(pad));
    off += t.data.length + pad;
  });
  return Buffer.concat(parts);
}

let _P = null;
async function pdfium() {
  if (!_P) {
    const wasmBinary = fs.readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
    _P = await require('@embedpdf/pdfium').init({ wasmBinary });
    _P.PDFiumExt_Init();
  }
  return _P;
}

async function open(buffer) {
  const P = await pdfium();
  const M = P.pdfium; // emscripten 모듈 (_malloc/_free/HEAPU8/getValue/...)

  // 힙은 메모리 성장 시 재할당되므로 매번 새로 참조한다.
  const heap = () => M.HEAPU8;
  const mal = (n) => M._malloc(n);
  const free = (p) => M._free(p);
  const f32 = (p) => M.getValue(p, 'float');
  const i32 = (p) => M.getValue(p, 'i32');
  const f64 = (p) => M.getValue(p, 'double');
  const utf16 = (s) => { const p = mal((s.length + 1) * 2); M.stringToUTF16(s, p, (s.length + 1) * 2); return p; };

  // FPDF_LoadMemDocument는 버퍼를 복사하지 않는다 → close()까지 살려둔다.
  const srcPtr = mal(buffer.length);
  heap().set(buffer, srcPtr);
  const doc = P.FPDF_LoadMemDocument(srcPtr, buffer.length, 0);
  if (!doc) { free(srcPtr); throw new Error('PDF를 열 수 없습니다 (손상 또는 암호화)'); }

  const pages = new Map();
  const page = (i) => {
    if (!pages.has(i)) {
      const h = P.FPDF_LoadPage(doc, i);
      if (!h) throw new Error(`page ${i} 로드 실패`);
      pages.set(i, h);
    }
    return pages.get(i);
  };

  // 폴백 폰트: 굵기별로 "지금까지 쓴 글자" 서브셋 하나를 유지한다.
  // 이미 올린 서브셋이 새 텍스트를 다 덮으면 그대로 재사용, 아니면 (기존 ∪ 새 글자)로 다시 서브셋해 새로 올린다.
  // ponytail: 합집합이라 이전 서브셋과 글리프가 겹쳐 중복 임베드된다(글자당 ~0.5KB).
  //   새 글자만 담으면 중복은 없지만 편집마다 폰트 객체가 늘어나고 헤더/공통 테이블이 매번 붙는다. 편집 수십 건 규모라 합집합이 싸다.
  const fbPtrs = [];                        // 문서가 닫힐 때까지 살려둬야 하는 폰트 버퍼 (PDFium이 복사하지 않는다)
  const fb = { regular: null, bold: null }; // { font, chars:Set }
  const customFonts = new Map();
  let selectedFont = null;
  function customFont(entry, text) {
    const cur = customFonts.get(entry.id);
    if (cur && [...text].every((c) => cur.chars.has(c))) return cur.font;
    const chars = new Set([...(cur?.chars || []), ...text]);
    const data = subsetTTF(entry.path, chars), ptr = mal(data.length);
    heap().set(data, ptr); fbPtrs.push(ptr);
    const font = P.FPDFText_LoadFont(doc, ptr, data.length, FPDF_FONT_TRUETYPE, true);
    if (!font) throw new Error('선택한 폰트를 PDF에 넣지 못했습니다.');
    customFonts.set(entry.id, { font, chars });
    fbBold.set(font, /bold|black|heavy/i.test(entry.label));
    return font;
  }
  function fallbackFont(bold, text) {
    const key = bold ? 'bold' : 'regular';
    const cur = fb[key];
    if (cur && [...text].every((c) => cur.chars.has(c))) return cur.font;
    const cands = bold ? ['C:\\Windows\\Fonts\\malgunbd.ttf', ...FALLBACK_FONTS] : FALLBACK_FONTS;
    const path = cands.find((p) => fs.existsSync(p));
    if (!path) return 0;
    const chars = new Set([...(cur ? cur.chars : []), ...text]);
    const data = subsetTTF(path, chars);
    const ptr = mal(data.length);
    heap().set(data, ptr);
    fbPtrs.push(ptr);
    const font = P.FPDFText_LoadFont(doc, ptr, data.length, FPDF_FONT_TRUETYPE, true);
    if (process.env.EDITORKIM_DEBUG) console.error('[fallbackFont]', key, path.split(/[\\/]/).pop(), 'chars', chars.size, 'bytes', data.length, 'font', font);
    if (!font) return 0;
    fb[key] = { font, chars };
    fbBold.set(font, !!bold);
    return font;
  }

  // 글리프 존재 확인 (실측으로 고른 방법):
  //   - FPDFFont_GetGlyphWidth: 글리프가 없어도 기본 폭을 돌려줌 → 못 씀.
  //   - FPDFFont_GetGlyphPath(font, unicode, size):
  //       표준/비CID 폰트(Helvetica)는 없는 글자에 0(null)을 준다.
  //       CID 서브셋 폰트(AAAAAA+MalgunGothicBold 같은 워드/한글 내보내기)는 0이 아니라
  //       '.notdef' 글리프 패스를 준다. 이때 없는 글자들은 전부 같은 포인터(캐시된 glyph 0)다.
  //     → 사설영역(PUA) 코드포인트로 notdef 포인터를 먼저 뽑아 두고, 그 포인터와 같으면 없는 글자로 본다.
  //       (PUA 두 개가 서로 다른 패스를 주면 notdef 판별을 포기하고 0 검사만 쓴다)
  //   공백류는 원래 빈 패스(0)라 검사에서 제외.
  // FPDFPageObjMark_GetName(mark, buffer, buflen, out_buflen) — buffer는 UTF-16LE. 먼저 0,0으로 불러 필요 바이트 수를 받는다.
  const markName = (mark) => {
    const outLen = mal(4);
    try {
      if (!P.FPDFPageObjMark_GetName(mark, 0, 0, outLen)) return '';
      const need = i32(outLen);
      if (!need) return '';
      const buf = mal(need);
      try { return P.FPDFPageObjMark_GetName(mark, buf, need, outLen) ? M.UTF16ToString(buf) : ''; }
      finally { free(buf); }
    } finally { free(outLen); }
  };

  const canRender = (font, text, size) => {
    const sz = size || 12;
    const a = P.FPDFFont_GetGlyphPath(font, 0xe000, sz);
    const notdef = a && a === P.FPDFFont_GetGlyphPath(font, 0xf8ff, sz) ? a : 0;
    for (const ch of text) {
      if (/\s/.test(ch)) continue;
      const gp = P.FPDFFont_GetGlyphPath(font, ch.codePointAt(0), sz);
      if (!gp || gp === notdef) return false;
    }
    return true;
  };

  // 굵기 판정: 우리가 올린 대체 폰트는 이름이 "Untitled"라 이름으로 알 수 없다 → 올릴 때 기억한 굵기(fbBold)를 쓴다.
  // 그 외에는 이름(Bold/Black/Heavy) 또는 PDFium이 읽은 weight(≥600). 이 판정이 틀리면 폭 맞춤의 두 번째 SetText에서 굵은 글자가 보통 굵기로 떨어진다(사용자 보고).
  const fbBold = new Map(); // 폰트 핸들 → bold
  const isBold = (o) => {
    const font = P.FPDFTextObj_GetFont(o);
    if (fbBold.has(font)) return fbBold.get(font);
    const nb = mal(256); const name = P.FPDFFont_GetBaseFontName(font, nb, 256) ? M.UTF8ToString(nb) : ''; free(nb);
    const w = P.FPDFFont_GetWeight ? P.FPDFFont_GetWeight(font) : 0;
    return /bold|black|heavy/i.test(name) || w >= 600;
  };

  const withBitmap = (i, scale, fn) => {
    const { w, h } = api.pageSize(i);
    const pw = Math.max(1, Math.round(w * scale)), ph = Math.max(1, Math.round(h * scale));
    const bmp = P.FPDFBitmap_Create(pw, ph, 0); // 항상 BGRA. REVERSE_BYTE_ORDER 플래그로 RGBA가 됨
    if (!bmp) throw new Error('비트맵 생성 실패');
    try {
      P.FPDFBitmap_FillRect(bmp, 0, 0, pw, ph, 0xffffffff);
      P.FPDF_RenderPageBitmap(bmp, page(i), 0, 0, pw, ph, 0, RENDER_FLAGS);
      return fn(bmp, pw, ph);
    } finally { P.FPDFBitmap_Destroy(bmp); }
  };

  // ── 그룹 마크: 줄바꿈 편집으로 만든 줄들, 사용자가 Shift 클릭으로 묶은 상자들을 콘텐츠 마크 EditorKimGroup(id)로 표시. 저장 후에도 유지 ──
  const findMark = (o, name) => { for (let k = 0, mc = P.FPDFPageObj_CountMarks(o); k < mc; k++) { const mk = P.FPDFPageObj_GetMark(o, k); const n = mk && markName(mk); if (n === name || n === LEGACY[name]) return mk; } return 0; };
  const markParam = (mk, key) => {
    const n = mal(4);
    try {
      if (!P.FPDFPageObjMark_GetParamStringValue(mk, key, 0, 0, n) || !i32(n)) return null;
      const len = i32(n), b = mal(len);
      try { return P.FPDFPageObjMark_GetParamStringValue(mk, key, b, len, n) ? M.UTF16ToString(b) : null; } finally { free(b); }
    } finally { free(n); }
  };
  const groupOf = (o) => { const mk = findMark(o, MARK_GROUP); return mk ? markParam(mk, 'id') : null; };
  const fontOf = (o) => { const mk = findMark(o, 'EditorKimFont'); return mk ? markParam(mk, 'id') : null; };
  const chosenFont = (o) => selectedFont || (fontOf(o) ? fontRegistry.get(fontOf(o)) : null);
  const tagFont = (o, entry) => {
    let mk; while ((mk = findMark(o, 'EditorKimFont'))) P.FPDFPageObj_RemoveMark(o, mk);
    mk = P.FPDFPageObj_AddMark(o, 'EditorKimFont');
    P.FPDFPageObjMark_SetStringParam(doc, o, mk, 'id', entry.id);
    P.FPDFPageObjMark_SetStringParam(doc, o, mk, 'label', entry.label);
  };
  const tagGroup = (o, id) => { // id=null이면 해제
    let mk; while ((mk = findMark(o, MARK_GROUP))) P.FPDFPageObj_RemoveMark(o, mk);
    if (id) { mk = P.FPDFPageObj_AddMark(o, MARK_GROUP); if (mk) P.FPDFPageObjMark_SetStringParam(doc, o, mk, 'id', id); }
  };
  const newGroupId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const api = {
    get pageCount() { return P.FPDF_GetPageCount(doc); },

    // 상자 묶기/풀기. idxs의 객체에 같은 그룹 id를 붙인다 (id 생략 시 새로 발급, null이면 해제)
    setGroup(i, idxs, id) {
      const p = page(i), gid = id === null ? null : id || newGroupId();
      let n = 0;
      for (const ix of [].concat(idxs)) { const o = P.FPDFPage_GetObject(p, ix); if (!o) continue; tagGroup(o, gid); n++; }
      P.FPDFPage_GenerateContent(p);
      return { ok: n > 0, id: gid, count: n };
    },

    pageSize(i) {
      const p = page(i);
      return { w: P.FPDF_GetPageWidthF(p), h: P.FPDF_GetPageHeightF(p) };
    },

    async render(i, scale = 1) {
      return withBitmap(i, scale, (bmp, pw, ph) => {
        const outPP = mal(4);
        try {
          // EPDF_PNG_EncodeRGBA(data, w, h, stride, zlibLevel, outPtrPtr) → 바이트 수
          const size = P.EPDF_PNG_EncodeRGBA(
            P.FPDFBitmap_GetBuffer(bmp), pw, ph, P.FPDFBitmap_GetStride(bmp), 6, outPP);
          const png = i32(outPP);
          if (!size || !png) throw new Error('PNG 인코딩 실패');
          const out = Buffer.from(heap().subarray(png, png + size));
          free(png);
          return out;
        } finally { free(outPP); }
      });
    },

    // Render only the selected region; no full document image is sent to AI.
    renderRegion(i, bounds, scale = 2) {
      const size = api.pageSize(i);
      if (!bounds || !Object.values(bounds).every(Number.isFinite)) throw new Error('잘못된 미리보기 범위');
      const x = Math.max(0, bounds.x0 - 8), top = Math.max(0, size.h - bounds.y1 - 8);
      const w = Math.min(size.w - x, bounds.x1 + 8 - x), h = Math.min(size.h - top, size.h - bounds.y0 + 8 - top);
      if (!(w > 0 && h > 0)) throw new Error('선택 영역이 페이지 밖에 있습니다.');
      const s = Math.min(scale, 1600 / w, 600 / h), pw = Math.max(1, Math.ceil(w * s)), ph = Math.max(1, Math.ceil(h * s));
      const bmp = P.FPDFBitmap_Create(pw, ph, 0), outPP = mal(4);
      if (!bmp) { free(outPP); throw new Error('미리보기 생성 실패'); }
      try {
        P.FPDFBitmap_FillRect(bmp, 0, 0, pw, ph, 0xffffffff);
        P.FPDF_RenderPageBitmap(bmp, page(i), -Math.round(x * s), -Math.round(top * s), Math.round(size.w * s), Math.round(size.h * s), 0, RENDER_FLAGS);
        const len = P.EPDF_PNG_EncodeRGBA(P.FPDFBitmap_GetBuffer(bmp), pw, ph, P.FPDFBitmap_GetStride(bmp), 6, outPP);
        const ptr = i32(outPP);
        if (!len || !ptr) throw new Error('미리보기 PNG 생성 실패');
        try { return Buffer.from(heap().subarray(ptr, ptr + len)); } finally { free(ptr); }
      } finally { free(outPP); P.FPDFBitmap_Destroy(bmp); }
    },

    setFontText(i, idx, text, { fontId, size, fit = true }) {
      const o = P.FPDFPage_GetObject(page(i), idx);
      if (!o || P.FPDFPageObj_GetType(o) !== OBJ_TEXT) throw new Error('텍스트 상자를 선택하세요.');
      if (typeof text !== 'string' || !text.trim() || text.length > 2000 || /[\r\n]/.test(text)) throw new Error('폰트 맞추기는 2,000자 이하의 한 줄씩 적용하세요.');
      if (!Number.isFinite(size) || size < 1 || size > 300) throw new Error('글자 크기는 1~300pt 범위로 입력하세요.');
      const entry = fontRegistry.get(fontId), absent = fontRegistry.missing(entry, text);
      if (absent.length) throw new Error(`선택한 폰트에 없는 글자: ${absent.slice(0, 12).join(' ')}`);
      const before = api.objects(i)[idx], previous = selectedFont;
      selectedFont = entry;
      try {
        // Preserve the old bounds for image covering; change size on the newly created object.
        selectedFont = { ...entry, size };
        const r = api.setText(i, idx, text);
        if (!r.ok) throw new Error('선택한 폰트로 글자를 그리지 못했습니다.');
        const index = r.idx ?? idx, neo = P.FPDFPage_GetObject(page(i), index);
        const after = api.objects(i)[index], width = after.bounds.x1 - after.bounds.x0;
        const maxWidth = before.bounds.x1 - before.bounds.x0;
        if (fit && width > maxWidth && maxWidth > 0) {
          const factor = maxWidth / width, m = mal(24);
          try {
            if (P.FPDFPageObj_GetMatrix(neo, m)) {
              for (const k of [0, 4, 8, 12]) M.setValue(m + k, f32(m + k) * factor, 'float');
              P.FPDFPageObj_SetMatrix(neo, m);
            }
          } finally { free(m); }
        }
        P.FPDFPage_GenerateContent(page(i));
        return { ...r, idx: index, fontId, fontLabel: entry.label };
      } finally { selectedFont = previous; }
    },

    fontStatus(i, idx, text) {
      const object = api.objects(i)[idx];
      if (!object || object.type !== 'text') throw new Error('텍스트 상자를 선택하세요.');
      const o = P.FPDFPage_GetObject(page(i), idx);
      if (object.hidden) return { needsAi: true, reason: '화면 글자가 그림으로 표시되어 검색용 폰트만으로 같은 모양을 재현할 수 없습니다.' };
      if (object.fontId) {
        try {
          if (!fontRegistry.missing(fontRegistry.get(object.fontId), text).length) return { needsAi: false, reason: '지정한 폰트로 직접 편집할 수 있습니다.' };
        } catch {}
        return { needsAi: true, reason: '지정한 폰트가 없거나 입력한 글자를 지원하지 않습니다.' };
      }
      if (canRender(P.FPDFTextObj_GetFont(o), text, object.size)) return { needsAi: false, reason: 'PDFium이 현재 폰트로 직접 편집할 수 있습니다.' };
      return { needsAi: true, reason: '원본 폰트를 재사용할 수 없거나 입력한 글리프가 없습니다.' };
    },

    // 자체 검사용: PNG 인코딩 없이 RGBA 원본 픽셀
    _renderRaw(i, scale = 1) {
      return withBitmap(i, scale, (bmp, pw, ph) => {
        const buf = P.FPDFBitmap_GetBuffer(bmp), stride = P.FPDFBitmap_GetStride(bmp);
        return { w: pw, h: ph, stride, data: Buffer.from(heap().subarray(buf, buf + stride * ph)) };
      });
    },

    objects(i) {
      const p = page(i), n = P.FPDFPage_CountObjects(p);
      const tp = P.FPDFText_LoadPage(p);
      const scratch = mal(32); // float 4개(bounds) + uint 4개(color) 공용
      try {
        const list = [];
        for (let idx = 0; idx < n; idx++) {
          const o = P.FPDFPage_GetObject(p, idx);
          const t = P.FPDFPageObj_GetType(o);
          const item = {
            idx,
            type: t === OBJ_TEXT ? 'text' : t === OBJ_IMAGE ? 'image' : t === OBJ_PATH ? 'path' : 'other',
            text: null, font: null, size: null,
            bounds: null, color: [0, 0, 0, 255], mask: false,
          };
          item.mask = !!findMark(o, MARK_MASK);
          // 보이지 않는 글자: 채움 알파 0 또는 렌더 모드 3(invisible)/7(clip). PowerPoint가 글자 효과를 그림으로 내보내며 검색용으로 깔아 둔 투명 글자
          if (t === OBJ_TEXT) { const rm = P.FPDFTextObj_GetTextRenderMode(o); item.hidden = rm === 3 || rm === 7; }
          item.group = groupOf(o); // 줄바꿈 줄들·사용자 그룹 (없으면 null)
          const fm = findMark(o, 'EditorKimFont');
          if (fm) { item.fontId = markParam(fm, 'id'); item.fontLabel = markParam(fm, 'label'); }
          P.FPDFPageObj_GetBounds(o, scratch, scratch + 4, scratch + 8, scratch + 12);
          item.bounds = { x0: f32(scratch), y0: f32(scratch + 4), x1: f32(scratch + 8), y1: f32(scratch + 12) };
          if (P.FPDFPageObj_GetFillColor(o, scratch, scratch + 4, scratch + 8, scratch + 12)) {
            item.color = [i32(scratch), i32(scratch + 4), i32(scratch + 8), i32(scratch + 12)];
          }
          if (t === OBJ_TEXT && item.color[3] === 0) item.hidden = true; // 알파 0도 투명 글자
          if (t === OBJ_TEXT) {
            const need = P.FPDFTextObj_GetText(o, tp, 0, 0); // 바이트 수(UTF-16, NUL 포함)
            if (need > 0) {
              const buf = mal(need);
              P.FPDFTextObj_GetText(o, tp, buf, need);
              item.text = M.UTF16ToString(buf);
              free(buf);
            } else item.text = '';
            P.FPDFTextObj_GetFontSize(o, scratch);
            item.size = f32(scratch);
            const font = P.FPDFTextObj_GetFont(o);
            const nb = mal(256);
            const len = P.FPDFFont_GetBaseFontName(font, nb, 256);
            item.font = len ? M.UTF8ToString(nb) : '';
            free(nb);
          }
          list.push(item);
        }
        return list;
      } finally { free(scratch); P.FPDFText_ClosePage(tp); }
    },

    // 줄바꿈 지원: PDF 텍스트 객체는 한 줄이라 '\n'을 넣으면 □로 그려진다.
    // 첫 줄은 기존 객체에(setOne), 나머지 줄은 같은 폰트·크기·색으로 새 객체를 만들어 행간만큼 아래(idx+k)에 넣는다.
    setText(i, idx, newText) {
      const lines = String(newText ?? '').split(/\r?\n/);
      const p = page(i), orig = P.FPDFPage_GetObject(p, idx);
      if (orig && P.FPDFPageObj_GetType(orig) === OBJ_TEXT) {
        const entry = chosenFont(orig);
        if (entry && fontRegistry.missing(entry, lines.join('')).length) return { ok: false, reason: '선택한 폰트에 입력한 글자가 없습니다.', fallbackFont: false };
      }
      // 굵기는 원래 객체에서 읽어 둔다 — _setOne이 폴백으로 바꾸면 폰트 이름이 "Untitled"라 굵기를 잃는다
      const bold = orig && P.FPDFPageObj_GetType(orig) === OBJ_TEXT ? isBold(orig) : false;
      const r = api._setOne(i, idx, lines[0]);
      if (!r.ok) return r;
      if (r.idx != null) idx = r.idx; // 투명 글자를 드러내면 객체가 맨 뒤로 간다
      if (lines.length < 2) { // 한 줄로 돌아오면 줄바꿈 그룹 표시는 뗀다
        const o1 = P.FPDFPage_GetObject(p, idx);
        if (o1 && findMark(o1, MARK_GROUP)) { tagGroup(o1, null); P.FPDFPage_GenerateContent(p); }
        return r;
      }
      const o = P.FPDFPage_GetObject(p, idx), gid = newGroupId();
      tagGroup(o, gid);
      const m = mal(24), c = mal(16);
      try {
        P.FPDFTextObj_GetFontSize(o, c); const size = f32(c);
        if (!P.FPDFPageObj_GetMatrix(o, m)) return r;
        // 행간 이동을 행렬(a b c d e f)에 통과시킨다: 텍스트 공간의 (0, −lh)는 사용자 공간에서 (−lh·c, −lh·d).
        // 기울임(synthetic italic, c≠0)·회전(b,c≠0) 텍스트도 같은 식으로 줄이 따라간다 — 계약서의 이탤릭 날짜 셀에서 둘째 줄이 사라지던 원인
        const cc = f32(m + 8), d = f32(m + 12), e = f32(m + 16), f = f32(m + 20);
        const lh = LINE_HEIGHT * size; // ponytail: 행간은 PDFium이 알려주지 않는다 → 글자 크기의 1.2배(텍스트 공간). 문서에 안 맞으면 LINE_HEIGHT 조정
        const color = P.FPDFPageObj_GetFillColor(o, c, c + 4, c + 8, c + 12) ? [i32(c), i32(c + 4), i32(c + 8), i32(c + 12)] : null;
        let fallback = r.fallbackFont; const lineIdxs = [idx];
        for (let k = 1; k < lines.length; k++) {
          const text = lines[k] || ' ';
          const entry = chosenFont(o);
          let font = entry ? customFont(entry, text) : P.FPDFTextObj_GetFont(o), fb = false;
          if (!canRender(font, text, size)) { font = fallbackFont(bold, text); fb = true; if (!font || !canRender(font, text, size)) continue; }
          const neo = P.FPDFPageObj_CreateTextObj(doc, font, size);
          const u = utf16(text); const ok = neo && P.FPDFText_SetText(neo, u); free(u);
          if (!ok) { if (neo) P.FPDFPageObj_Destroy(neo); continue; }
          M.setValue(m + 16, e - k * lh * cc, 'float'); M.setValue(m + 20, f - k * lh * d, 'float'); P.FPDFPageObj_SetMatrix(neo, m);
          if (color) P.FPDFPageObj_SetFillColor(neo, color[0], color[1], color[2], color[3]);
          // 맨 뒤(가장 위 z-순서)에 넣는다. 원래 글자 바로 뒤에 끼우면 표 셀 배경 같은 뒤쪽 채움 도형이 새 줄을 덮어 글자가 사라진다
          tagGroup(neo, gid);
          if (entry) tagFont(neo, entry);
          P.FPDFPage_InsertObject(p, neo);
          lineIdxs.push(P.FPDFPage_CountObjects(p) - 1); fallback = fallback || fb;
        }
        P.FPDFPage_GenerateContent(p);
        return { ok: true, fallbackFont: fallback, inserted: lineIdxs.length - 1, lineIdxs, group: gid };
      } finally { free(m); free(c); }
    },
    // 폭 맞춤. 긴 글을 넣어도 옆 글자와 겹치지 않게:
    //   'wrap'   사용 가능한 폭(maxWidth)에 맞춰 단어 단위 줄바꿈 → setText의 여러 줄 배치. 폭 측정은 실제로 SetText 해보고 bounds를 읽는다(폰트 메트릭 추정 없음)
    //   'shrink' 첫 줄 폭이 넘치면 행렬(a,d)을 같은 비율로 줄여 글자를 축소 (표 셀처럼 줄을 늘릴 수 없을 때)
    //   'none'   그대로 (setText)
    fitText(i, idx, text, maxWidth, mode = 'wrap') {
      if (!(maxWidth > 0) || mode === 'none') return api.setText(i, idx, text);
      const width = (s) => { const r = api._setOne(i, idx, s); if (!r.ok) return -1; if (r.idx != null) idx = r.idx; const b = api.objects(i)[idx].bounds; return b.x1 - b.x0; };
      const lines = String(text ?? '').split(/\r?\n/);
      if (mode === 'shrink') {
        const w = Math.max(...lines.map(width));
        const r = api.setText(i, idx, text);
        if (r.ok && w > maxWidth) {
          const s = maxWidth / w, m = mal(24), p = page(i);
          try {
            for (const li of r.lineIdxs || [idx]) {
              const o = P.FPDFPage_GetObject(p, li);
              if (!P.FPDFPageObj_GetMatrix(o, m)) continue;
              M.setValue(m, f32(m) * s, 'float'); M.setValue(m + 12, f32(m + 12) * s, 'float'); // a, d만 축소 (원점 e,f 유지)
              P.FPDFPageObj_SetMatrix(o, m);
            }
            P.FPDFPage_GenerateContent(p);
          } finally { free(m); }
          r.scaled = s;
        }
        return r;
      }
      const out = [];
      for (let line of lines) {
        for (let guard = 0; guard < 50 && line !== null; guard++) {
          const w = width(line);
          if (w < 0 || w <= maxWidth || line.trim().length < 2) { out.push(line); break; }
          let cut = Math.max(1, Math.floor(line.length * maxWidth / w)); // 폭 비례로 자르고, 그 앞의 공백이 있으면 단어 경계로
          const sp = line.lastIndexOf(' ', cut); if (sp > 0) cut = sp;
          out.push(line.slice(0, cut).trimEnd()); line = line.slice(cut).trimStart();
          if (!line) line = null;
        }
      }
      const r = api.setText(i, idx, out.join('\n'));
      r.wrapped = out.length;
      return r;
    },

    // 한 줄 교체(내부). 1) 원본 폰트로 그릴 수 있으면 그대로 SetText (폰트·모양 보존)
    //                   2) 글리프가 없으면 시스템 한글 폰트로 새 객체를 만들어 자리 바꿔치기
    // 한 줄 교체 + 투명 글자 처리. 투명 글자(hidden)를 고치면: 그 자리의 그림을 배경색 사각형으로 덮고, 글자를 글자색으로 보이게 바꿔 맨 위에 올린다.
    // 객체가 맨 뒤로 가므로 idx가 바뀐다 → {idx}로 돌려준다.
    _setOne(i, idx, newText) {
      const p = page(i), o0 = P.FPDFPage_GetObject(p, idx);
      if (!o0 || P.FPDFPageObj_GetType(o0) !== OBJ_TEXT) return { ok: false, fallbackFont: false };
      const hidden = !!(o0 && P.FPDFPageObj_GetType(o0) === OBJ_TEXT && [3, 7].includes(P.FPDFTextObj_GetTextRenderMode(o0)) || (o0 && (() => { const c = mal(16); try { return P.FPDFPageObj_GetFillColor(o0, c, c + 4, c + 8, c + 12) && i32(c + 12) === 0; } finally { free(c); } })()));
      let cover = null, ink = null, background = null;
      if (hidden) { // 편집 전에 재야 한다: 그림(보이는 글자)이 아직 있을 때 배경색·글자색을 뽑는다
        const all = api.objects(i), b = all[idx].bounds, pad = 3;
        cover = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
        // 보이는 글자는 그림 타일이고, 타일은 투명 텍스트 상자와 어긋나 있다(PowerPoint: 한 조각의 타일이 옆 조각 자리까지 걸침).
        // 텍스트 상자와 세로로 절반 이상 겹치고 가로로 겹치거나 맞닿은(2pt) 이미지 타일을 모두 덮는 범위에 넣는다.
        const th = b.y1 - b.y0;
        for (const o of all) {
          if (o.type !== 'image' || !o.bounds) continue;
          const vy = Math.min(o.bounds.y1, b.y1) - Math.max(o.bounds.y0, b.y0);
          const hx = Math.min(o.bounds.x1, b.x1) - Math.max(o.bounds.x0, b.x0);
          const tw = o.bounds.x1 - o.bounds.x0;
          // 가로로 '실질적으로' 겹치는 타일만(겹침 폭이 타일·텍스트 중 좁은 쪽의 절반 이상). 맞닿기만 한 옆 조각 타일은 제외
          if (vy > 0.5 * th && hx > 0.5 * Math.min(tw, b.x1 - b.x0)) cover = { x0: Math.min(cover.x0, o.bounds.x0), y0: Math.min(cover.y0, o.bounds.y0), x1: Math.max(cover.x1, o.bounds.x1), y1: Math.max(cover.y1, o.bounds.y1) };
        }
        // 타일은 옆 단어까지 걸치므로, 타일 범위 안에서 '이 단어의 잉크가 이어지는 가로 구간'만 덮는다:
        // 텍스트 상자 가운데에서 좌우로 나가며 잉크 없는 빈 열이 gap(글자 크기의 0.25) 이상 이어지면 멈춘다
        cover = api._inkExtent(i, cover, b);
        ink = api.sampleInk(i, cover);
        background = api.sampleColor(i, cover);
      }
      // 투명 글자는 항상 새 객체로 다시 만든다(forceNew): 제자리 SetText면 옛 객체의 ExtGState(ca 0)가 저장 시 그대로 기록돼 다시 투명해진다
      const r = api._setOneRaw(i, idx, newText, hidden);
      if (!r.ok || !hidden) return r;
      const o = P.FPDFPage_GetObject(p, idx);
      P.FPDFTextObj_SetTextRenderMode(o, 0);
      // 알파 254: PDFium은 알파가 정확히 1.0이면 gs를 안 써서 원래의 ca 0(투명)이 저장 후 되살아난다. 1.0이 아닌 값이어야 명시적으로 기록된다
      P.FPDFPageObj_SetFillColor(o, ink[0], ink[1], ink[2], 254);
      // 폰트/글리프 검사에 실패하면 원본 화면을 그대로 둔다. 배경은 교체 전에 측정하되 덮개는 성공 후에만 추가한다.
      api.addRect(i, cover, background);
      P.FPDFPage_RemoveObject(p, o); P.FPDFPage_InsertObject(p, o); // 맨 위(z-순서)로
      P.FPDFPage_GenerateContent(p);
      return { ...r, idx: P.FPDFPage_CountObjects(p) - 1, revealed: true, ink };
    },

    _setOneRaw(i, idx, newText, forceNew = false) {
      if (!newText) newText = ' '; // 빈 문자열로 SetText하면 PDFium(WASM)이 unreachable 트랩으로 죽는다
      const p = page(i);
      const o = P.FPDFPage_GetObject(p, idx);
      if (!o || P.FPDFPageObj_GetType(o) !== OBJ_TEXT) return { ok: false, fallbackFont: false };

      const scratch = mal(24); // FS_MATRIX(6 float) 겸 float/색 버퍼
      const u16 = utf16(newText);
      try {
        P.FPDFTextObj_GetFontSize(o, scratch);
        const entry = chosenFont(o);
        const size = selectedFont?.size || f32(scratch);
        // 우리가 넣은 대체 폰트("Untitled")는 제자리 SetText를 하지 않는다: 저장·재열기(실행 취소) 뒤에 그 객체를 다시 SetText하면
        // PDFium이 임베드 폰트 대신 시스템 폰트로 대체해 가늘고 벌어진 글자가 된다(사용자 보고). 항상 새 서브셋으로 객체를 다시 만든다.
        const nb0 = mal(256); const fname = P.FPDFFont_GetBaseFontName(P.FPDFTextObj_GetFont(o), nb0, 256) ? M.UTF8ToString(nb0) : ''; free(nb0);
        const origOk = !entry && fname !== 'Untitled' && canRender(P.FPDFTextObj_GetFont(o), newText, size);
        if (origOk && !forceNew) {
          const ok = !!P.FPDFText_SetText(o, u16);
          if (ok) P.FPDFPage_GenerateContent(p);
          return { ok, fallbackFont: false };
        }

        const bold = isBold(o);
        // forceNew이고 원본 폰트로 그릴 수 있으면 원본 폰트로 새 객체(폰트 보존), 아니면 대체 폰트
        const usingOrig = origOk && forceNew;
        const font = entry ? customFont(entry, newText) : usingOrig ? P.FPDFTextObj_GetFont(o) : fallbackFont(bold, newText);
        // 시스템 한글 폰트가 없거나, 서브셋에도 없는 글자(폰트 자체에 글리프 없음)면 두부(□)로 그려질 테니 거절
        if (!font || !canRender(font, newText, size)) return { ok: false, fallbackFont: false };

        const neo = P.FPDFPageObj_CreateTextObj(doc, font, size);
        if (!neo || !P.FPDFText_SetText(neo, u16)) {
          if (neo) P.FPDFPageObj_Destroy(neo);
          return { ok: false, fallbackFont: false };
        }
        if (P.FPDFPageObj_GetMatrix(o, scratch)) P.FPDFPageObj_SetMatrix(neo, scratch);
        if (P.FPDFPageObj_GetFillColor(o, scratch, scratch + 4, scratch + 8, scratch + 12)) {
          P.FPDFPageObj_SetFillColor(neo, i32(scratch), i32(scratch + 4), i32(scratch + 8), i32(scratch + 12));
        }
        if (entry) tagFont(neo, entry);
        const gid = groupOf(o); if (gid) tagGroup(neo, gid);
        // 같은 자리에 넣어 idx가 밀리지 않게 한다
        if (!P.FPDFPage_InsertObjectAtIndex(p, neo, idx)) P.FPDFPage_InsertObject(p, neo);
        P.FPDFPage_RemoveObject(p, o);
        P.FPDFPageObj_Destroy(o); // 페이지에서 뗀 객체는 직접 해제해야 샘 안 남
        // 투명 글자 교체는 _setOne에서 색/알파를 확정한 뒤 콘텐츠를 만든다.
        // ca=0인 중간 객체를 먼저 기록하면 PDFium의 ExtGState 리소스가 재사용돼 저장 후 다시 투명해질 수 있다.
        if (!forceNew) P.FPDFPage_GenerateContent(p);
        return { ok: true, fallbackFont: !usingOrig && !entry };
      } finally { free(u16); free(scratch); }
    },

    // ── H: 글자 상자 / 이동 / 사각형 / 마스킹 ──────────────────────────────
    // 텍스트 페이지의 글자 인덱스는 페이지 전체 기준이라 객체별로 나눠야 한다.
    // FPDFText_GetTextObject(tp, c)가 그 글자를 그린 페이지 객체 포인터를 그대로 준다
    // → 좌표 허용오차나 유니코드 대조 없이 정확히 매칭된다.
    //   (객체 사이에 끼는 합성 \r\n 은 포인터 0 이라 자동으로 걸러진다)
    charBoxes(i, idx) {
      const p = page(i);
      const o = P.FPDFPage_GetObject(p, idx);
      if (!o || P.FPDFPageObj_GetType(o) !== OBJ_TEXT) return [];
      const tp = P.FPDFText_LoadPage(p);
      const s = mal(32); // double 4개: left, right, bottom, top
      try {
        const out = [];
        for (let c = 0, n = P.FPDFText_CountChars(tp); c < n; c++) {
          if (P.FPDFText_GetTextObject(tp, c) !== o) continue;
          const ch = String.fromCharCode(P.FPDFText_GetUnicode(tp, c));
          // 공백은 PDFium이 빈 상자(0,0,0,0)를 줄 수 있다. 문자열과 길이를 맞춰야 하므로 그대로 담는다.
          const ok = P.FPDFText_GetCharBox(tp, c, s, s + 8, s + 16, s + 24);
          out.push(ok
            ? { ch, x0: f64(s), y0: f64(s + 16), x1: f64(s + 8), y1: f64(s + 24) }
            : { ch, x0: 0, y0: 0, x1: 0, y1: 0 });
        }
        // 객체 텍스트와 길이를 맞춘다. Word/Excel 출력물은 객체 텍스트 끝에 공백을 달고 있고(계약서 PDF 97개 중 50개),
        // Chromium 출력물은 한 글자 조각마다 뒤 공백이 붙는데, 텍스트 페이지는 그 공백을 내놓지 않는다.
        // 빠진 공백 자리에 0폭 합성 상자를 끼워 넣어 인덱스가 텍스트와 1:1이 되게 한다. 공백이 아닌 글자가 안 맞으면 원래 목록을 돌려준다(호출자가 길이 불일치로 판단).
        const need = P.FPDFTextObj_GetText(o, tp, 0, 0);
        let text = '';
        if (need > 0) { const b = mal(need); P.FPDFTextObj_GetText(o, tp, b, need); text = M.UTF16ToString(b); free(b); }
        const aligned = []; let j = 0;
        for (let k = 0; k < text.length; k++) {
          const ch = text[k];
          if (j < out.length && out[j].ch === ch) { aligned.push(out[j++]); continue; }
          if (!/\s/.test(ch)) return out;
          const prev = aligned[aligned.length - 1], next = out[j];
          const x = prev ? prev.x1 : next ? next.x0 : 0, ref = prev || next || { y0: 0, y1: 0 };
          aligned.push({ ch, x0: x, y0: ref.y0, x1: x, y1: ref.y1 });
        }
        return j === out.length ? aligned : out;
      } finally { free(s); P.FPDFText_ClosePage(tp); }
    },

    move(i, idxs, dx, dy) {
      const p = page(i), n = P.FPDFPage_CountObjects(p);
      let moved = 0;
      for (const idx of [].concat(idxs)) {
        if (!(idx >= 0 && idx < n)) continue;
        const o = P.FPDFPage_GetObject(p, idx);
        if (!o) continue;
        P.FPDFPageObj_Transform(o, 1, 0, 0, 1, dx, dy);
        moved++;
      }
      if (moved) P.FPDFPage_GenerateContent(p);
      return { ok: moved > 0, moved };
    },

    // FPDFPageObj_CreateNewRect(x, y, w, h) — x1,y1 이 아니라 폭·높이다
    addRect(i, r, color = [0, 0, 0, 255]) {
      const p = page(i);
      const o = P.FPDFPageObj_CreateNewRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      if (!o) return { idx: -1 };
      P.FPDFPageObj_SetFillColor(o, color[0], color[1], color[2], color[3] == null ? 255 : color[3]);
      P.FPDFPath_SetDrawMode(o, 1, false); // FPDF_FILLMODE_WINDING, stroke=false
      P.FPDFPageObj_AddMark(o, MARK_MASK); // 콘텐츠 마크: 저장·재열기 후에도 "이게 우리가 만든 가림 상자"임을 식별
      P.FPDFPage_InsertObject(p, o);       // 맨 위에 얹는다
      P.FPDFPage_GenerateContent(p);
      return { idx: P.FPDFPage_CountObjects(p) - 1 };
    },

    // 테스트 전용: 마크를 옛 이름(LEGACY)으로 다시 달아 하위 호환 읽기를 검증한다
    _addLegacyMark(i, idx) {
      const o = P.FPDFPage_GetObject(page(i), idx);
      if (!o) return { ok: false };
      let mk; while ((mk = findMark(o, MARK_MASK))) P.FPDFPageObj_RemoveMark(o, mk);
      P.FPDFPageObj_AddMark(o, LEGACY[MARK_MASK]);
      return { ok: true };
    },

    // 객체 하나를 페이지에서 제거 (가림 상자 삭제용)
    removeObject(i, idx) {
      const p = page(i);
      const o = P.FPDFPage_GetObject(p, idx);
      if (!o) return { ok: false };
      const ok = !!P.FPDFPage_RemoveObject(p, o);
      if (ok) { P.FPDFPageObj_Destroy(o); P.FPDFPage_GenerateContent(p); }
      return { ok };
    },

    // 글자 [from,to)를 텍스트에서 실제로 지우고 그 자리에 검은 사각형을 덮는다.
    // 뒤쪽 글자는 새 텍스트 객체로 분리해 원래 위치에 다시 놓는다(idx+1에 삽입 → 뒤 인덱스가 1씩 밀린다).
    // 영역의 배경색 추출: 페이지를 1배로 렌더해 영역 픽셀을 32단계로 양자화, 가장 많은 색 묶음의 평균 → [r,g,b,255]
    // 글자·선은 소수라 최빈색은 배경(흰색, 셀 색, 슬라이드 배경)이 된다. 영역이 이미지 한가운데면 이미지의 주 색이 나온다.
    sampleColor(i, b) {
      const { w: pw, h: ph } = api.pageSize(i);
      const raw = api._renderRaw(i, 1);
      const x0 = Math.max(0, Math.floor(Math.min(b.x0, b.x1))), x1 = Math.min(raw.w - 1, Math.ceil(Math.max(b.x0, b.x1)));
      const y0 = Math.max(0, Math.floor(ph - Math.max(b.y0, b.y1))), y1 = Math.min(raw.h - 1, Math.ceil(ph - Math.min(b.y0, b.y1)));
      const buckets = new Map();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const p = y * raw.stride + x * 4, r = raw.data[p], g = raw.data[p + 1], bl = raw.data[p + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (bl >> 3);
        const acc = buckets.get(key) || [0, 0, 0, 0]; acc[0] += r; acc[1] += g; acc[2] += bl; acc[3]++; buckets.set(key, acc);
      }
      let best = null; for (const a of buckets.values()) if (!best || a[3] > best[3]) best = a;
      if (!best) return [255, 255, 255, 255];
      return [Math.round(best[0] / best[3]), Math.round(best[1] / best[3]), Math.round(best[2] / best[3]), 255];
    },

    // region 안에서 seed(텍스트 상자) 가운데를 기준으로 잉크가 이어지는 가로 구간을 찾는다 (2배 렌더, 배경과 다른 픽셀 = 잉크)
    _inkExtent(i, region, seed) {
      const s = 2, { h: ph } = api.pageSize(i), raw = api._renderRaw(i, s), bg = api.sampleColor(i, region);
      const x0 = Math.max(0, Math.floor(region.x0 * s)), x1 = Math.min(raw.w - 1, Math.ceil(region.x1 * s));
      const y0 = Math.max(0, Math.floor((ph - region.y1) * s)), y1 = Math.min(raw.h - 1, Math.ceil((ph - region.y0) * s));
      const inkCol = (x) => { for (let y = y0; y <= y1; y++) { const p = y * raw.stride + x * 4; if (Math.abs(raw.data[p] - bg[0]) + Math.abs(raw.data[p + 1] - bg[1]) + Math.abs(raw.data[p + 2] - bg[2]) >= 120) return true; } return false; };
      const gap = Math.max(3, Math.round(0.25 * (seed.y1 - seed.y0) * s));
      const cx = Math.round((seed.x0 + seed.x1) / 2 * s);
      let L = cx, R = cx;
      for (let x = cx, blank = 0; x >= x0; x--) { if (inkCol(x)) { blank = 0; L = x; } else if (++blank >= gap) break; }
      for (let x = cx, blank = 0; x <= x1; x++) { if (inkCol(x)) { blank = 0; R = x; } else if (++blank >= gap) break; }
      if (R - L < 4) return region; // 잉크를 못 찾으면(이미 덮였거나 비어 있음) 그대로
      const pad = 1.5;
      return { x0: Math.max(region.x0, L / s - pad), x1: Math.min(region.x1, R / s + pad), y0: region.y0, y1: region.y1 };
    },

    // 시험용: 객체 채움색 강제 (알파 0 → 투명 글자 재현)
    _setFillColor(i, idx, c) { const o = P.FPDFPage_GetObject(page(i), idx); const ok = !!(o && P.FPDFPageObj_SetFillColor(o, c[0], c[1], c[2], c[3])); if (ok) P.FPDFPage_GenerateContent(page(i)); return ok; },

    // 영역의 글자색 추출: 배경색과 충분히 다른 픽셀(글자·선) 중 최빈색. 없으면 검정
    sampleInk(i, b) {
      const bg = api.sampleColor(i, b), { h: ph } = api.pageSize(i);
      const raw = api._renderRaw(i, 1);
      const x0 = Math.max(0, Math.floor(Math.min(b.x0, b.x1))), x1 = Math.min(raw.w - 1, Math.ceil(Math.max(b.x0, b.x1)));
      const y0 = Math.max(0, Math.floor(ph - Math.max(b.y0, b.y1))), y1 = Math.min(raw.h - 1, Math.ceil(ph - Math.min(b.y0, b.y1)));
      const buckets = new Map();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const p = y * raw.stride + x * 4, r = raw.data[p], g = raw.data[p + 1], bl = raw.data[p + 2];
        if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(bl - bg[2]) < 120) continue;
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (bl >> 3);
        const acc = buckets.get(key) || [0, 0, 0, 0]; acc[0] += r; acc[1] += g; acc[2] += bl; acc[3]++; buckets.set(key, acc);
      }
      let best = null; for (const a of buckets.values()) if (!best || a[3] > best[3]) best = a;
      return best ? [Math.round(best[0] / best[3]), Math.round(best[1] / best[3]), Math.round(best[2] / best[3]), 255] : [0, 0, 0, 255];
    },

    // color: [r,g,b,a] | 'auto'(배경색 추출) | 생략(검정)
    redact(i, idx, from, to, color) {
      const p = page(i);
      const o = P.FPDFPage_GetObject(p, idx);
      if (!o || P.FPDFPageObj_GetType(o) !== OBJ_TEXT) return { ok: false, reason: 'not-text' };

      const item = api.objects(i)[idx];
      const text = item.text || '';
      from = Math.max(0, Math.min(from | 0, text.length));
      to = Math.max(from, Math.min(to | 0, text.length));
      if (from === to) return { ok: false, reason: 'empty' };

      const boxes = api.charBoxes(i, idx);
      if (boxes.length !== text.length) return { ok: false, reason: 'charmap' };

      const scratch = mal(24);
      try {
        if (!P.FPDFPageObj_GetMatrix(o, scratch)) return { ok: false, reason: 'matrix' };
        const m = [0, 4, 8, 12, 16, 20].map((k) => f32(scratch + k)); // a b c d e f
        if (Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01) return { ok: false, reason: 'rotated' };

        // 가릴 영역: 지워지는 글자 상자들의 합집합 (빈 상자는 무시), 없으면 객체 전체
        let cover = null;
        for (let k = from; k < to; k++) {
          const b = boxes[k];
          if (b.x1 <= b.x0) continue;
          cover = cover
            ? { x0: Math.min(cover.x0, b.x0), y0: Math.min(cover.y0, b.y0), x1: Math.max(cover.x1, b.x1), y1: Math.max(cover.y1, b.y1) }
            : { ...b };
        }
        if (!cover) cover = { ...item.bounds };
        const PAD = 0.5;
        cover = { x0: cover.x0 - PAD, y0: cover.y0 - PAD, x1: cover.x1 + PAD, y1: cover.y1 + PAD };

        const prefix = text.slice(0, from), suffix = text.slice(to);
        let inserted = -1;

        if (suffix) {
          const font = P.FPDFTextObj_GetFont(o);
          const neo = font ? P.FPDFPageObj_CreateTextObj(doc, font, item.size || 12) : 0;
          const u16 = neo ? utf16(suffix) : 0;
          if (!neo || !P.FPDFText_SetText(neo, u16)) {
            if (u16) free(u16);
            if (neo) P.FPDFPageObj_Destroy(neo);
            return { ok: false, reason: 'suffix-font' };
          }
          free(u16);
          // 상자 기준 상대 이동량. e 는 펜 시작점이라 첫 글자 상자 x0 와 lsb 만큼 어긋나므로
          // 절대값이 아니라 (지운 뒤 첫 글자 − 원래 첫 글자) 차이를 쓴다.
          const dx = (boxes[to] && boxes[to].x1 > boxes[to].x0 ? boxes[to].x0 : cover.x1 + PAD) - boxes[0].x0;
          M.setValue(scratch + 16, m[4] + dx, 'float'); // scratch에는 아직 원본 행렬이 들어 있다
          P.FPDFPageObj_SetMatrix(neo, scratch);
          P.FPDFPageObj_SetFillColor(neo, item.color[0], item.color[1], item.color[2], item.color[3]);
          if (P.FPDFPage_InsertObjectAtIndex(p, neo, idx + 1)) inserted = idx + 1;
          else { P.FPDFPage_InsertObject(p, neo); inserted = P.FPDFPage_CountObjects(p) - 1; }
        }

        // 빈 문자열로 SetText 하면 PDFium이 트랩으로 죽는다 → 공백 하나 (민감한 글자는 남지 않는다)
        const pre = utf16(prefix || ' ');
        const okPre = !!P.FPDFText_SetText(o, pre);
        free(pre);
        if (!okPre) return { ok: false, reason: 'prefix' };

        api.addRect(i, cover, color === 'auto' ? api.sampleColor(i, cover) : (color || [0, 0, 0, 255]));
        P.FPDFPage_GenerateContent(p);
        return { ok: true, rects: [cover], inserted };
      } finally { free(scratch); }
    },

    pageText(i) {
      const tp = P.FPDFText_LoadPage(page(i));
      try {
        const n = P.FPDFText_CountChars(tp);
        if (n <= 0) return '';
        const buf = mal((n + 1) * 2);
        P.FPDFText_GetText(tp, 0, n, buf);
        const s = M.UTF16ToString(buf);
        free(buf);
        return s;
      } finally { P.FPDFText_ClosePage(tp); }
    },

    save() {
      const w = P.PDFiumExt_OpenFileWriter();
      try {
        if (!P.PDFiumExt_SaveAsCopy(doc, w)) throw new Error('저장 실패');
        const size = P.PDFiumExt_GetFileWriterSize(w);
        const out = mal(size);
        try {
          P.PDFiumExt_GetFileWriterData(w, out, size);
          return Buffer.from(heap().subarray(out, out + size));
        } finally { free(out); }
      } finally { P.PDFiumExt_CloseFileWriter(w); }
    },

    close() {
      for (const h of pages.values()) P.FPDF_ClosePage(h);
      pages.clear();
      P.FPDF_CloseDocument(doc);
      free(srcPtr);
      for (const p of fbPtrs.splice(0)) free(p);
      fb.regular = fb.bold = null;
    },
  };
  return api;
}

module.exports = { open };
