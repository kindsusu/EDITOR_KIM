// Microsoft Store(MSIX/AppX) 타일·로고 생성 → build/appx/*.png. electron-builder의 appx 대상이 이 폴더를 그대로 패키지에 넣는다.
// 원본은 앱 아이콘과 같은 build/icon.svg(어두운 둥근 정사각형 + 가려진 줄). 넓은 타일은 같은 배경색(#1b1b1f) 가운데에 아이콘을 둔다.
// 실행: npm run appx-assets  (= electron tools/make-appx-assets.js)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // 크기마다 창을 새로 열고 닫는다 — 마지막 창이 닫혀도 앱이 꺼지지 않게

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
const BG = '#1b1b1f';
// [파일, 폭, 높이, 아이콘 크기 비율] — 이름은 electron-builder appx 대상이 찾는 기본 이름
const assets = [
  ['StoreLogo.png', 50, 50, 1],
  ['Square44x44Logo.png', 44, 44, 1],
  ['Square150x150Logo.png', 150, 150, 0.8],
  ['Wide310x150Logo.png', 310, 150, 0.8],
  ['LargeTile.png', 310, 310, 0.7],
  ['SmallTile.png', 71, 71, 0.9],
];

app.whenReady().then(async () => {
  const out = path.join(root, 'build', 'appx');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, w, h, ratio] of assets) {
    const s = Math.round(Math.min(w, h) * ratio);
    // 정사각 작은 로고(아이콘 그대로)는 투명 배경, 타일은 배경색으로 채운다
    const bg = ratio === 1 ? 'transparent' : BG;
    const win = new BrowserWindow({ width: w, height: h, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
    const html = `<body style="margin:0;width:${w}px;height:${h}px;background:${bg};overflow:hidden;display:flex;align-items:center;justify-content:center">`
      + svg.replace('width="512" height="512"', `width="${s}" height="${s}"`) + '</body>';
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 300));
    // 화면 배율이 걸린 PC에서는 캡처가 더 크게 나온다 → 항상 지정 크기로 맞춘다
    const img = (await win.webContents.capturePage()).resize({ width: w, height: h, quality: 'best' });
    fs.writeFileSync(path.join(out, name), img.toPNG());
    console.log(`build/appx/${name}`, img.getSize());
    win.destroy();
  }
  app.quit();
});
