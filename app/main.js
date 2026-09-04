// Electron 셸: 서버를 같은 프로세스에서 띄우고 창을 연다
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { PORT } = require('./server.js');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1400, height: 900, title: '대필', autoHideMenuBar: true, backgroundColor: '#1b1b1f',
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

  // 닫을 때 미저장 경고
  let allowClose = false;
  win.on('close', async (e) => {
    if (allowClose) return;
    e.preventDefault();
    const dirty = await win.webContents.executeJavaScript('window.isDirty ? window.isDirty() : false').catch(() => false);
    if (dirty && dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['저장 안 하고 닫기', '취소'], defaultId: 1, cancelId: 1, message: '저장하지 않은 변경이 있습니다.' }) === 1) return;
    allowClose = true; win.close();
  });
});
app.on('window-all-closed', () => app.quit());
