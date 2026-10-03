// README 대표 이미지 생성 → assets/hero.png (1774×887, 2:1)
// 앱 이름 변경(EDITOR_KIM → Retext PDF, 2026-10-03)으로 옛 이름이 박힌 생성 이미지를 대신한다.
// 디자인은 앱 아이콘과 같은 언어: 어두운 바탕(#1b1b1f), 크림색 종이(#f2ece4), 글줄(#3a3a40), 강조 주황(#d97757).
// 오른쪽 장면은 앱이 실제로 하는 두 가지 — 줄을 눌러 글자를 고치는 편집 창, 글자를 지우고 덮는 가리기 — 를 그린다.
// 글자는 Windows 기본 글꼴(Segoe UI)만 쓴다(오프스크린 렌더에서 한글 글꼴이 대체되는 함정을 피해 영문만).
// 실행: npm run hero  (= electron tools/make-hero.js)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();

const W = 1774, H = 887;
const C = { bg: '#1b1b1f', paper: '#f2ece4', fold: '#d9d2c6', ink: '#3a3a40', acc: '#d97757', text: '#f2ece4', mut: '#9a958c', card: '#26262c', line: '#3a3a42' };
const bar = (x, y, w, h = 14, fill = C.ink) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`;
const font = `font-family="Segoe UI, Arial, sans-serif"`;

// 왼쪽: 아이콘 + 이름 + 한 줄 소개 + 특징 세 가지
const icon = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s / 512})">
  <rect width="512" height="512" rx="104" fill="#26262c"/>
  <path d="M136 88 h184 l56 56 v280 a12 12 0 0 1 -12 12 h-228 a12 12 0 0 1 -12 -12 v-324 a12 12 0 0 1 12 -12 Z" fill="${C.paper}"/>
  <path d="M320 88 v44 a12 12 0 0 0 12 12 h44 Z" fill="${C.fold}"/>
  ${bar(168, 156, 132, 22)}${bar(168, 206, 176, 22)}${bar(160, 251, 192, 32, C.acc)}${bar(168, 306, 160, 22)}${bar(168, 356, 92, 22)}
</g>`;
// 칩 폭은 글자 수로 어림한다(Segoe UI 21px 평균 글자 폭 약 10.4px) — 칩끼리 16px 띄워 차례로 놓는다
const chipW = (label) => 58 + label.length * 10.4;
const chips = (x, y, labels) => labels.map((label) => {
  const w = chipW(label), g = `<g><rect x="${x}" y="${y}" width="${w}" height="46" rx="23" fill="none" stroke="${C.line}" stroke-width="2"/>
    <circle cx="${x + 24}" cy="${y + 23}" r="5" fill="${C.acc}"/>
    <text x="${x + 38}" y="${y + 30}" ${font} font-size="21" fill="${C.text}" opacity=".88">${label}</text></g>`;
  x += w + 16; return g;
}).join('');
const left = `
  ${icon(120, 214, 112)}
  <text x="114" y="452" ${font} font-size="128" font-weight="600" letter-spacing="-3" fill="${C.text}">Retext <tspan fill="${C.acc}">PDF</tspan></text>
  <text x="120" y="530" ${font} font-size="40" fill="${C.text}">Edit the real text in your PDFs.</text>
  <text x="120" y="584" ${font} font-size="40" fill="${C.mut}">Redact it for real.</text>
  ${chips(120, 640, ['Line-level editing', 'True redaction', 'Works offline'])}`;

// 오른쪽: 문서 한 장(살짝 기울임) + 고치는 줄 + 가린 줄 + 편집 창 카드
const px = 1000, py = 120, pw = 560, ph = 680;
const doc = `
  <g transform="rotate(-3 ${px + pw / 2} ${py + ph / 2})">
    <rect x="${px + 14}" y="${py + 22}" width="${pw}" height="${ph}" rx="18" fill="#000" opacity=".35"/>
    <path d="M${px + 18} ${py} h${pw - 110} l92 92 v${ph - 110} a18 18 0 0 1 -18 18 h-${pw - 36} a18 18 0 0 1 -18 -18 v-${ph - 36} a18 18 0 0 1 18 -18 Z" fill="${C.paper}"/>
    <path d="M${px + pw - 92} ${py} v72 a20 20 0 0 0 20 20 h72 Z" fill="${C.fold}"/>
    <text x="${px + 56}" y="${py + 92}" ${font} font-size="34" font-weight="700" fill="#26262c">Meeting notes</text>
    ${bar(px + 56, py + 128, 300)}${bar(px + 56, py + 164, 420)}${bar(px + 56, py + 200, 360)}
    <rect x="${px + 44}" y="${py + 238}" width="452" height="56" rx="6" fill="none" stroke="${C.acc}" stroke-width="3"/>
    <text x="${px + 58}" y="${py + 276}" ${font} font-size="28" fill="#26262c">Budget approved for <tspan font-weight="700">Q4</tspan></text>
    <rect x="${px + 364}" y="${py + 252}" width="3" height="32" fill="${C.acc}"/>
    ${bar(px + 56, py + 328, 400)}${bar(px + 56, py + 364, 330)}
    <text x="${px + 56}" y="${py + 440}" ${font} font-size="24" fill="#26262c">Contact:</text>
    <rect x="${px + 160}" y="${py + 416}" width="250" height="34" rx="3" fill="#111114"/>
    ${bar(px + 56, py + 486, 380)}${bar(px + 56, py + 522, 260)}${bar(px + 56, py + 558, 340)}
  </g>`;
// 편집 창 카드(앱의 "이 줄 고치기" 패널을 단순화)
const cx = 860, cy = 610, cw = 400, ch = 214; // 가린 줄(종이 중간)을 덮지 않게 종이 왼쪽 아래에 걸친다
const card = `
  <g>
    <rect x="${cx + 8}" y="${cy + 14}" width="${cw}" height="${ch}" rx="16" fill="#000" opacity=".45"/>
    <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="16" fill="${C.card}" stroke="${C.acc}" stroke-width="2"/>
    <text x="${cx + 28}" y="${cy + 46}" ${font} font-size="22" font-weight="600" fill="${C.text}">Edit this line</text>
    <rect x="${cx + 28}" y="${cy + 68}" width="${cw - 56}" height="52" rx="8" fill="#f7f5f0"/>
    <text x="${cx + 44}" y="${cy + 102}" ${font} font-size="22" fill="#26262c">Budget approved for Q4</text>
    <rect x="${cx + 284}" y="${cy + 80}" width="2" height="28" fill="${C.acc}"/>
    <rect x="${cx + 28}" y="${cy + 142}" width="120" height="44" rx="8" fill="${C.acc}"/>
    <text x="${cx + 88}" y="${cy + 171}" ${font} font-size="20" font-weight="600" fill="#fff" text-anchor="middle">Apply</text>
    <text x="${cx + 168}" y="${cy + 171}" ${font} font-size="18" fill="${C.mut}">Original font kept</text>
  </g>`;
// 가린 줄 옆 표시
const tag = `
  <g>
    <path d="M1440 540 L1500 498" stroke="${C.mut}" stroke-width="2" fill="none"/>
    <rect x="1500" y="470" width="180" height="46" rx="23" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>
    <text x="1590" y="500" ${font} font-size="20" fill="${C.text}" text-anchor="middle">Text removed</text>
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><radialGradient id="glow" cx="72%" cy="48%" r="45%"><stop offset="0" stop-color="${C.acc}" stop-opacity=".22"/><stop offset="1" stop-color="${C.acc}" stop-opacity="0"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${left}${doc}${card}${tag}
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, webPreferences: { offscreen: true } });
  const html = `<body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${C.bg}">${svg}</body>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));
  // 화면 배율이 걸린 PC에서는 캡처가 더 크게 나온다 → 항상 1774×887로 맞춘다
  const img = (await win.webContents.capturePage()).resize({ width: W, height: H, quality: 'best' });
  const out = process.argv.find((a) => a.endsWith('.png')) || path.join(__dirname, '..', 'assets', 'hero.png');
  fs.writeFileSync(out, img.toPNG());
  console.log(path.relative(process.cwd(), out), img.getSize());
  app.quit();
});
