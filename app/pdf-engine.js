// PDFium(WASM) 얇은 래퍼 — 열기 / 렌더(PNG) / 객체 목록 / 텍스트 교체 / 저장
// 계약: PLAN.md P2 "엔진 계약" 참고.
const fs = require('fs');

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

  // ponytail: PDFium은 FPDFText_LoadFont로 넣은 폰트를 서브셋하지 않는다 →
  //   폴백이 한 번이라도 쓰이면 저장 파일이 malgun.ttf(약 7.5MB)만큼 커진다.
  //   문제가 되면 저장 시 폰트 서브셋(예: fontkit/subset-font)을 붙인다.
  const fb = { regular: null, bold: null }; // 폴백 폰트 (doc당 굵기별 1회 로드) { font, data }
  function fallbackFont(bold) {
    const key = bold ? 'bold' : 'regular';
    if (fb[key]) return fb[key].font;
    const cands = bold ? ['C:\\Windows\\Fonts\\malgunbd.ttf', ...FALLBACK_FONTS] : FALLBACK_FONTS;
    const path = cands.find((p) => fs.existsSync(p));
    if (!path) return 0;
    const data = fs.readFileSync(path);
    const ptr = mal(data.length);
    heap().set(data, ptr);
    const font = P.FPDFText_LoadFont(doc, ptr, data.length, FPDF_FONT_TRUETYPE, true);
    fb[key] = { font, data: ptr };
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

  const api = {
    get pageCount() { return P.FPDF_GetPageCount(doc); },

    pageSize(i) {
      const p = page(i);
      return { w: P.FPDF_GetPageWidthF(p), h: P.FPDF_GetPageHeightF(p) };
    },

    async render(i, scale = 1) {
      const { w, h } = api.pageSize(i);
      const pw = Math.max(1, Math.round(w * scale)), ph = Math.max(1, Math.round(h * scale));
      const bmp = P.FPDFBitmap_Create(pw, ph, 0); // 항상 BGRA. REVERSE_BYTE_ORDER 플래그로 RGBA가 됨
      if (!bmp) throw new Error('비트맵 생성 실패');
      try {
        P.FPDFBitmap_FillRect(bmp, 0, 0, pw, ph, 0xffffffff);
        P.FPDF_RenderPageBitmap(bmp, page(i), 0, 0, pw, ph, 0, RENDER_FLAGS);
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
      } finally { P.FPDFBitmap_Destroy(bmp); }
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
        const font = fallbackFont(bold);
        if (!font) return { ok: false, fallbackFont: false }; // 시스템 한글 폰트 없음

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
      for (const k of Object.keys(fb)) { if (fb[k]) free(fb[k].data); fb[k] = null; }
    },
  };
  return api;
}

module.exports = { open };
