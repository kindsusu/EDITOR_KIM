const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('editorKim', { openFolder: () => ipcRenderer.invoke('openFolder'), openFiles: () => ipcRenderer.invoke('openFiles'), openFont: () => ipcRenderer.invoke('openFont'), saveAs: (defaultPath) => ipcRenderer.invoke('saveAs', defaultPath) });
