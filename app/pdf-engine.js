// PDFium(WASM) 얇은 래퍼 — 열기 / 렌더(PNG) / 객체 목록 / 텍스트 교체 / 저장
// 계약: PLAN.md P2 "엔진 계약" 참고.
const fs = require('fs');
const fontkit = require('fontkit');

const OBJ_TEXT = 1, OBJ_PATH = 2, OBJ_IMAGE = 3; // FPDF_PAGEOBJ_*
const RENDER_FLAGS = 0x01 | 0x10;                // FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER(=RGBA로 뽑기)
const FPDF_FONT_TRUETYPE = 2;

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
    if (!font) return 0;
    fb[key] = { font, chars };
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

  const api = {
    get pageCount() { return P.FPDF_GetPageCount(doc); },

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
            bounds: null, color: [0, 0, 0, 255],
          };
          P.FPDFPageObj_GetBounds(o, scratch, scratch + 4, scratch + 8, scratch + 12);
          item.bounds = { x0: f32(scratch), y0: f32(scratch + 4), x1: f32(scratch + 8), y1: f32(scratch + 12) };
          if (P.FPDFPageObj_GetFillColor(o, scratch, scratch + 4, scratch + 8, scratch + 12)) {
            item.color = [i32(scratch), i32(scratch + 4), i32(scratch + 8), i32(scratch + 12)];
          }
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

    // 1) 원본 폰트로 그릴 수 있으면 그대로 SetText (폰트·모양 보존)
    // 2) 글리프가 없으면 시스템 한글 폰트로 새 객체를 만들어 자리 바꿔치기
    setText(i, idx, newText) {
      if (!newText) newText = ' '; // 빈 문자열로 SetText하면 PDFium(WASM)이 unreachable 트랩으로 죽는다
      const p = page(i);
      const o = P.FPDFPage_GetObject(p, idx);
      if (!o || P.FPDFPageObj_GetType(o) !== OBJ_TEXT) return { ok: false, fallbackFont: false };

      const scratch = mal(24); // FS_MATRIX(6 float) 겸 float/색 버퍼
      const u16 = utf16(newText);
      try {
        P.FPDFTextObj_GetFontSize(o, scratch);
        const size = f32(scratch);
        if (canRender(P.FPDFTextObj_GetFont(o), newText, size)) {
          const ok = !!P.FPDFText_SetText(o, u16);
          if (ok) P.FPDFPage_GenerateContent(p);
          return { ok, fallbackFont: false };
        }

        const nb = mal(256);
        const bold = P.FPDFFont_GetBaseFontName(P.FPDFTextObj_GetFont(o), nb, 256) && /bold|black|heavy/i.test(M.UTF8ToString(nb));
        free(nb);
        const font = fallbackFont(bold, newText);
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
        // 같은 자리에 넣어 idx가 밀리지 않게 한다
        if (!P.FPDFPage_InsertObjectAtIndex(p, neo, idx)) P.FPDFPage_InsertObject(p, neo);
        P.FPDFPage_RemoveObject(p, o);
        P.FPDFPageObj_Destroy(o); // 페이지에서 뗀 객체는 직접 해제해야 샘 안 남
        P.FPDFPage_GenerateContent(p);
        return { ok: true, fallbackFont: true };
      } finally { free(u16); free(scratch); }
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
