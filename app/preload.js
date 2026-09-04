const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('daepil', { openFolder: () => ipcRenderer.invoke('openFolder'), openFiles: () => ipcRenderer.invoke('openFiles') });
