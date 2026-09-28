const assert = require('assert');
const { open } = require('./pdf-engine');

// Minimal nonembedded Korean CID font, using the same encoding as FPDF-generated estimates.
function fixture() {
  const content = 'BT /F1 18 Tf 1 0 0 1 40 100 Tm <B0A1B3AA> Tj ET'; // 가나다 subset: 가나
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJoStd-Medium-Acro /Encoding /KSCms-UHC-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJoStd-Medium-Acro /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 1 >> /FontDescriptor 6 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /HYSMyeongJoStd-Medium-Acro /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.3\n', offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(pdf + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

(async () => {
  const doc = await open(fixture());
  try {
    const text = doc.objects(0)[0];
    assert.equal(text.text.trim(), '가나');
    assert.ok(text.bounds.y1 - text.bounds.y0 > 5, 'nonembedded Korean has selectable ink bounds');
    const raw = doc._renderRaw(0, 1);
    let ink = 0; for (let i = 0; i < raw.data.length; i += 4) if (raw.data[i] < 100) ink++;
    assert.ok(ink > 50, 'Korean glyphs render visibly without rewriting PDF objects');
    const saved = await open(doc.save());
    try { assert.equal(saved.objects(0)[0].text.trim(), '가나'); assert.ok(saved.objects(0)[0].bounds.y1 > saved.objects(0)[0].bounds.y0); }
    finally { saved.close(); }
    assert.ok(doc.setText(0, 0, '나라').ok);
    const edited = await open(doc.save());
    try { assert.equal(edited.objects(0)[0].text.trim(), '나라'); assert.ok(edited.objects(0)[0].bounds.y1 > edited.objects(0)[0].bounds.y0); }
    finally { edited.close(); }
    console.log('OK — nonembedded Korean rendering, selection bounds, editing and save/reopen');
  } finally { doc.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
