'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('edutalk', {
  getStatus: () => ipcRenderer.invoke('edutalk:get-status'),
  onStatus: (fn) => {
    const h = (_e, s) => { try { fn(s); } catch (e) {} };
    ipcRenderer.on('edutalk:status', h);
    return () => ipcRenderer.removeListener('edutalk:status', h);
  },
  openAdmin: () => ipcRenderer.invoke('edutalk:open-admin'),
  copy: (text) => ipcRenderer.invoke('edutalk:copy', text),
  restartServer: () => ipcRenderer.invoke('edutalk:restart-server'),
});
