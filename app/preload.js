const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('editorKim', {
  openFolder: () => ipcRenderer.invoke('openFolder'),
  openFiles: () => ipcRenderer.invoke('openFiles'),
  openPdfFiles: () => ipcRenderer.invoke('openPdfFiles'), // P5 WP-B2: 여러 파일 용량 줄이기용 PDF 여러 개 선택
  openFont: () => ipcRenderer.invoke('openFont'),
  openImage: () => ipcRenderer.invoke('openImage'), // P4 WP-B2: 페이지에 삽입할 PNG/JPEG 한 장
  saveAs: (defaultPath, opts) => ipcRenderer.invoke('saveAs', defaultPath, opts),
  // 연결 프로그램으로 더블클릭·`electron . <파일>`·두 번째 실행으로 열린 파일을 렌더러에 전달(main.js가 open-paths로 보냄)
  onOpenPaths: (cb) => ipcRenderer.on('open-paths', (_e, paths) => cb(paths)),
  // 드래그해 놓은 File 객체에서 실제 파일 경로를 얻는다(webUtils.getPathForFile — File.path는 보안상 제거됨)
  pathsFromFiles: (files) => Array.from(files).map((f) => webUtils.getPathForFile(f)),
});
