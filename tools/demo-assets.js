// README용 실제 렌더 이미지 생성: 편집·마스킹 전/후 (워크스페이스의 가상 회의록 PDF 사용)
// node tools/demo-assets.js  → assets/edit-before.png, assets/edit-after.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { open } = require('../app/pdf-engine');

const SRC = path.join(__dirname, '..', 'workspace', '회의록_초안.pdf');
const OUT = path.join(__dirname, '..', 'assets');
const SCALE = 2, CROP_H = 0.42; // 위쪽 42%만

function png(rgba, w, h, stride) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * stride, y * stride + w * 4); }
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
async function shot(doc, file) {
  const r = doc._renderRaw(0, SCALE);
  const h = Math.round(r.h * CROP_H);
  fs.writeFileSync(path.join(OUT, file), png(r.data, r.w, h, r.stride));
  console.log(file, r.w + 'x' + h);
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const doc = await open(fs.readFileSync(SRC));
  await shot(doc, 'edit-before.png');
  const objs = doc.objects(0).filter((o) => o.type === 'text');
  // 1) 제목 "(초안)" → "(확정)": 조각 객체라 "초" "안" 조각을 찾아 첫 조각에 넣고 나머지는 공백
  const find = (s) => objs.find((o) => o.text.startsWith(s));
  const cho = find('초'), an = find('안');
  if (cho && an) { doc.setText(0, cho.idx, '확정'); doc.setText(0, an.idx, ' '); }
  // 2) "참석:" 줄의 "재무팀장" 마스킹 — 조각 객체를 줄로 묶어 범위를 찾고, 텍스트 제거 + 검은 사각형 (UI의 /api/pdf/mask와 같은 절차)
  const anchor = objs.find((o) => o.text.includes('참석')) || objs.find((o) => o.text.trim() === '참');
  const line = objs.filter((o) => Math.abs(o.bounds.y0 - anchor.bounds.y0) < 3).sort((a, b) => a.bounds.x0 - b.bounds.x0);
  let pos = 0; const spans = line.map((o) => { const s = { o, from: pos, to: pos + o.text.length }; pos += o.text.length; return s; });
  const full = line.map((o) => o.text).join(''), f = full.indexOf('재무팀장'), t = f + 4;
  const parts = spans.filter((s) => s.to > f && s.from < t).map((s) => ({ idx: s.o.idx, from: Math.max(0, f - s.from), to: Math.min(s.o.text.length, t - s.from), o: s.o }));
  const rects = [];
  for (const p of parts.sort((a, b) => b.idx - a.idx)) {
    const r = doc.redact(0, p.idx, p.from, p.to);
    if (r.ok) rects.push(...r.rects);
    else { doc.setText(0, p.idx, ' '); rects.push(p.o.bounds); }
  }
  const u = rects.reduce((b, r) => ({ x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0), x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
  doc.addRect(0, u, [0, 0, 0, 255]);
  const count = (s) => s.split('재무팀장').length - 1;
  console.log('masked parts', parts.length, '| occurrences before', count(full) + 1, 'after', count(doc.pageText(0)), '(결정 사항 줄의 1건은 그대로 둠)');
  await shot(doc, 'edit-after.png');
  doc.close();
})();
