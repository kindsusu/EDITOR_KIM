// Electron 셸: 서버를 같은 프로세스에서 띄우고 창을 연다
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { PORT } = require('./server.js');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1400, height: 900, title: `대필 v${require('../package.json').version}`, autoHideMenuBar: true, backgroundColor: '#1b1b1f',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadURL(`http://localhost:${PORT}`);
  win.on('page-title-updated', (e) => e.preventDefault());

  ipcMain.handle('openFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '작업 폴더 선택' });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('openFiles', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF · Markdown', extensions: ['pdf', 'md'] }], title: '파일 열기' });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('saveAs', async (_e, defaultPath) => {
    const isPdf = /\.pdf$/i.test(defaultPath || '');
    const filters = isPdf ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'Markdown', extensions: ['md'] }];
    const r = await dialog.showSaveDialog(win, { defaultPath, filters, title: '다른 이름으로 저장' });
    return r.canceled ? null : r.filePath;
  });

  // 닫을 때 미저장이면 네 가지 중 선택. 저장은 렌더러의 window.daepilSave / daepilSaveAs가 수행하고 성공 여부(true/false)를 돌려준다
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
      if (r === 0 && !(await exec('window.daepilSave ? window.daepilSave() : false'))) return;
      if (r === 1 && !(await exec('window.daepilSaveAs ? window.daepilSaveAs() : false'))) return; // 저장 대화상자에서 취소하면 닫지 않음
    }
    allowClose = true; win.close();
  });
});
app.on('window-all-closed', () => app.quit());
