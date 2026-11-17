const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omeAdmin', {
  sendSignal: (slotId, payload) => ipcRenderer.send('admin:signal', { slotId, payload }),
  onSignal: (callback) => {
    const handler = (_event, data) => callback(data.slotId, data.payload);
    ipcRenderer.on('slot:signal', handler);
    return () => ipcRenderer.removeListener('slot:signal', handler);
  },
  onSlotStatus: (callback) => {
    const handler = (_event, data) => callback(data.slotId, data.status);
    ipcRenderer.on('slot:status', handler);
    return () => ipcRenderer.removeListener('slot:status', handler);
  },
  onSlotNav: (callback) => {
    const handler = (_event, data) => callback(data.slotId, data.url);
    ipcRenderer.on('slot:nav', handler);
    return () => ipcRenderer.removeListener('slot:nav', handler);
  },
  loadUrl: (target, url) => ipcRenderer.invoke('admin:load-url', { target, url }),
  reloadSlot: (target) => ipcRenderer.invoke('admin:reload', { target }),
  domAction: (target, action) => ipcRenderer.send('admin:dom-action', { target, action }),
  setViewsVisible: (visible) => ipcRenderer.send('admin:set-views-visible', visible),
  setProxy: (slotId, proxyRules) => ipcRenderer.invoke('admin:set-proxy', { slotId, proxyRules }),
  clearSession: (slotId) => ipcRenderer.invoke('admin:clear-session', { slotId }),
  openDevTools: (target) => ipcRenderer.send('admin:open-devtools', target),
  fetchMyInstants: (query) => ipcRenderer.invoke('admin:fetch-myinstants', query),
  fetchAudio: (soundPath) => ipcRenderer.invoke('admin:fetch-audio', soundPath)
});
