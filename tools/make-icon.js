// 앱 아이콘 생성: 어두운 배경에 "대" 한 글자 → build/icon.png (512px). electron-builder가 .ico로 변환한다.
// 실행: node_modules\.bin\electron tools\make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, webPreferences: { offscreen: true } });
  const html = `<body style="margin:0;width:512px;height:512px;background:#1b1b1f;display:flex;align-items:center;justify-content:center;border-radius:96px">
    <div style="font:700 300px 'Malgun Gothic',sans-serif;color:#d97757;line-height:1;margin-top:-12px">대</div></body>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), img.toPNG());
  console.log('build/icon.png', img.getSize());
  app.quit();
});
