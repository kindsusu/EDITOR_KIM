// 앱 아이콘 생성 → build/icon.png (512px, 투명 모서리) + build/icon.svg (원본). electron-builder가 .ico로 변환한다.
// 디자인 "가려진 줄"(2026-09-09 시안 B 채택): 어두운 둥근 정사각형(#1b1b1f) 안의 크림색 종이(#f2ece4, 귀 접힘)와 글줄 다섯 개(#3a3a40),
// 그중 한 줄이 주황(#d97757) 막대로 완전히 덮여 있다 — "가리면 진짜로 지워진다"는 마스킹 기능을 그대로 그린 장면.
// 예전 아이콘은 한글 "대"를 시스템 폰트로 그렸는데 오프스크린 렌더에 글꼴이 없어 "D" 비슷한 모양으로 나왔다 → 글꼴에 의존하지 않는 벡터 도형만 쓴다.
// 실행: npm run icon  (= electron tools/make-icon.js)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();

const line = (y, x0, x1, fill = '#3a3a40', h = 22) => `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="${h}" rx="${h / 2}" fill="${fill}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="104" fill="#1b1b1f"/>
  <path d="M136 88 h184 l56 56 v280 a12 12 0 0 1 -12 12 h-228 a12 12 0 0 1 -12 -12 v-324 a12 12 0 0 1 12 -12 Z" fill="#f2ece4"/>
  <path d="M320 88 v44 a12 12 0 0 0 12 12 h44 Z" fill="#d9d2c6"/>
  ${line(156, 168, 300)}
  ${line(206, 168, 344)}
  ${line(251, 160, 352, '#d97757', 32)}
  ${line(306, 168, 328)}
  ${line(356, 168, 260)}
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const html = `<body style="margin:0;width:512px;height:512px;background:transparent;overflow:hidden">${svg}</body>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  // 화면 배율(125%·150%)이 걸린 PC에서는 캡처가 512보다 크게 나온다 → 항상 512로 맞춘다
  const img = (await win.webContents.capturePage()).resize({ width: 512, height: 512, quality: 'best' });
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), img.toPNG());
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), svg);
  console.log('build/icon.png', img.getSize());
  app.quit();
});
