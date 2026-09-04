const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('editorKim', { openFolder: () => ipcRenderer.invoke('openFolder'), openFiles: () => ipcRenderer.invoke('openFiles'), saveAs: (defaultPath) => ipcRenderer.invoke('saveAs', defaultPath) });
