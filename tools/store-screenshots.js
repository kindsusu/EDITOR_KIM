// Microsoft Store 제출용 스크린샷 → store/screenshot-*.png (1366×768, Store 권장 크기)
// 저장소의 가상 문서(workspace/회의록_초안.*)만 임시 작업 폴더에 복사해 연다. 사용자의 설정(~/.editor-kim.json)과
// 실행 중인 앱(4747)은 건드리지 않도록 임시 홈 폴더·다른 포트(4849)·메모리 전용 세션(localStorage 비어 있음)을 쓴다.
// 실행: npx electron tools/store-screenshots.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-kim-shots-'));
const ws = path.join(home, '문서');
fs.mkdirSync(ws);
for (const f of ['회의록_초안.pdf', '회의록_초안.md']) fs.copyFileSync(path.join(root, 'workspace', f), path.join(ws, f));
fs.writeFileSync(path.join(home, '.editor-kim.json'), JSON.stringify({ workspace: ws }));

const { app, BrowserWindow } = require('electron');
const W = 1366, H = 768;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  // os.homedir()가 이 값을 쓴다 — 서버를 읽기 직전에 바꾼다(Electron 시작 전에 바꾸면 whenReady가 끝나지 않는다)
  process.env.USERPROFILE = home; process.env.HOME = home;
  process.env.EDITORKIM_PORT = '4849';
  const port = await require(path.join(root, 'app', 'server.js')).ready;
  const win = new BrowserWindow({ width: W, height: H, show: false, backgroundColor: '#1b1b1f', webPreferences: { offscreen: true, partition: 'store-shots' } });
  await win.loadURL(`http://localhost:${port}`);
  await wait(1500);
  const out = path.join(root, 'store');
  fs.mkdirSync(out, { recursive: true });
  const shot = async (name) => {
    await wait(1500);
    const img = await win.webContents.capturePage();
    const { width, height } = img.getSize();
    const fitted = width === W && height === H ? img : img.resize({ width: W, height: H, quality: 'best' });
    fs.writeFileSync(path.join(out, name), fitted.toPNG());
    console.log(`store/${name}`, fitted.getSize());
  };
  // 반환값(DOM 등)은 복제할 수 없어 버린다
  const js = (code) => win.webContents.executeJavaScript(`Promise.resolve((() => { ${code} })()).then(() => true)`);
  const clickFile = (name) => js(`const el = [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(name)}); (el.closest('.f, li, button') || el).click();`);

  await clickFile('회의록_초안.pdf');
  await shot('screenshot-1-pdf.png');
  // 한 줄을 눌러 편집 창을 연 장면
  await js(`const b = [...document.querySelectorAll('.pdfBox')][2]; b && b.click();`);
  await shot('screenshot-2-edit.png');
  await js(`document.querySelectorAll('.pdfEditor').forEach((e) => e.remove());`);
  await clickFile('회의록_초안.md');
  await shot('screenshot-3-markdown.png');

  win.destroy();
  fs.rmSync(home, { recursive: true, force: true });
  app.exit(0);
});
