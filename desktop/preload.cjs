'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fsh777', {
  desktop: true,
  platform: process.platform,
  saveFile: value => ipcRenderer.invoke('fsh777:save-file', value),
  listFonts: () => ipcRenderer.invoke('fsh777:list-fonts'),
  onDownloadStatus(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => {
      if (value && ['completed', 'cancelled', 'interrupted'].includes(value.state) && typeof value.name === 'string') callback({ state: value.state, name: value.name.slice(0, 240) });
    };
    ipcRenderer.on('fsh777:download-status', listener);
    return () => ipcRenderer.removeListener('fsh777:download-status', listener);
  },
});
