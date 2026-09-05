// Electron 셸: 서버를 같은 프로세스에서 띄우고 창을 연다
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const { PORT } = require('./server.js');

// 기본 메뉴를 쓰지 않는다: 그 단축키(Ctrl+R 새로고침, Ctrl+=/− 페이지 전체 확대, Ctrl+W 닫기)가 편집기 단축키(PDF 확대·축소)를 가로채고,
// 새로고침은 편집 중인 화면 상태를 날린다. 개발자 도구는 F12로 연다.
Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1400, height: 900, title: `EDITOR_KIM v${require('../package.json').version}`, autoHideMenuBar: true, backgroundColor: '#1b1b1f',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadURL(`http://localhost:${PORT}`);
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  // 페이지 전체 확대(Chromium 줌)는 쓰지 않는다 — PDF 확대는 렌더러가 Ctrl+휠·Ctrl+=/−로 처리한다
  win.webContents.on('did-finish-load', () => { win.webContents.setZoomFactor(1); win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {}); });

  ipcMain.handle('openFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '작업 폴더 선택' });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('openFiles', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF · Markdown', extensions: ['pdf', 'md'] }], title: '파일 열기' });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('openFont', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'TrueType 폰트', extensions: ['ttf'] }], title: '사용할 TTF 폰트 선택' });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('saveAs', async (_e, defaultPath) => {
    const isPdf = /\.pdf$/i.test(defaultPath || '');
    const filters = isPdf ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'Markdown', extensions: ['md'] }];
    const r = await dialog.showSaveDialog(win, { defaultPath, filters, title: '다른 이름으로 저장' });
    return r.canceled ? null : r.filePath;
  });

  // 닫을 때 미저장이면 네 가지 중 선택. 저장은 렌더러의 window.editorKimSave / editorKimSaveAs가 수행하고 성공 여부(true/false)를 돌려준다
  let allowClose = false;
  const exec = (js) => win.webContents.executeJavaScript(js).catch(() => false);
  win.on('close', async (e) => {
    if (allowClose) return;
    e.preventDefault();
    const dirty = await exec('window.isDirty ? window.isDirty() : false');
    if (dirty) {
      const r = dialog.showMessageBoxSync(win, {
        type: 'warning', message: '저장하지 않은 변경이 있습니다.', detail: '어떻게 할까요?',
        buttons: ['이 문서에 덮어쓰기', '다른 이름으로 저장', '저장하지 않고 닫기', '취소'], defaultId: 0, cancelId: 3, noLink: true,
      });
      if (r === 3) return;
      if (r === 0 && !(await exec('window.editorKimSave ? window.editorKimSave() : false'))) return;
      if (r === 1 && !(await exec('window.editorKimSaveAs ? window.editorKimSaveAs() : false'))) return; // 저장 대화상자에서 취소하면 닫지 않음
    }
    allowClose = true; win.close();
  });
});
app.on('window-all-closed', () => app.quit());
