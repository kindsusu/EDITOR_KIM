// Microsoft Store 제출용 스크린샷 → store/screenshot-*.png (1366×768, Store 권장 크기)
// 저장소의 가상 문서(workspace/회의록_초안.*)만 임시 작업 폴더에 복사해 연다. 사용자의 설정(~/.editor-kim.json)과
// 실행 중인 앱(4747)은 건드리지 않도록 임시 홈 폴더·다른 포트(4849)·메모리 전용 세션(localStorage 비어 있음)을 쓴다.
// 실행: npx electron tools/store-screenshots.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..');
// 임시 홈은 %TEMP%가 아니라 store/ 아래에 둔다 — %TEMP% 안의 파일은 앱이 "임시 파일입니다" 띠를 띄워 화면에 찍힌다
const out = path.join(root, 'store');
fs.mkdirSync(out, { recursive: true });
const home = fs.mkdtempSync(path.join(out, '.home-'));
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
  // 설치된 앱과 같은 화면이 되도록 preload를 붙인다(없으면 브라우저 모드 화면이 찍힌다). 대화상자용 IPC 처리기는 없지만 찍는 데는 쓰지 않는다
  const win = new BrowserWindow({ width: W, height: H, show: false, backgroundColor: '#1b1b1f',
    webPreferences: { offscreen: true, partition: 'store-shots', preload: path.join(root, 'app', 'preload.js') } });
  await win.loadURL(`http://localhost:${port}`);
  await wait(1500);
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
  // 첫 실행 안내·AI 로그인 창 등 떠 있는 대화상자는 닫고 찍는다
  const closeDialogs = () => js(`document.querySelectorAll('dialog[open]').forEach((d) => d.close());`);
  const pdf = path.join(ws, '회의록_초안.pdf'), md = path.join(ws, '회의록_초안.md');

  // 연결 프로그램으로 연 것과 같은 경로(main.js의 open-paths) — 목록에 둘 다 넣고 첫 파일(PDF)을 연다
  win.webContents.send('open-paths', [pdf, md]);
  await wait(2500);
  await closeDialogs();
  await shot('screenshot-1-pdf.png');
  // 제목 줄을 눌러 편집 창을 연 장면(아래 줄을 고르면 창이 화면 밑으로 잘린다). 상자는 마우스 누름/뗌으로 선택하므로(attachDrag) .click()이 아니라 실제 입력을 보낸다
  const at = await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('#pdf .pdfBox:not(.pdfMask):not(.pdfImage)')][0]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  if (at) {
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  } else console.log('편집할 줄 상자를 찾지 못했습니다');
  await shot('screenshot-2-edit.png');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(300);
  await js(`document.querySelector('#files [data-f$=".md"]').click();`);
  await closeDialogs();
  await shot('screenshot-3-markdown.png');

  win.destroy();
  fs.rmSync(home, { recursive: true, force: true });
  app.exit(0);
});
