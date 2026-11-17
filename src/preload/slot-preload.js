const fs = require('fs');
const path = require('path');
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const slotArg = process.argv.find((a) => a.startsWith('--ometroll-slot='));
const slotId = slotArg ? slotArg.split('=')[1] : 'A';

contextBridge.exposeInMainWorld('__omeTroll', {
  slotId,
  sendSignal: (payload) => ipcRenderer.send('slot:signal', payload),
  onSignal: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('admin:signal', handler);
    return () => ipcRenderer.removeListener('admin:signal', handler);
  },
  sendStatus: (status) => ipcRenderer.send('slot:status', status)
});

try {
  const hookPath = path.join(__dirname, 'slot-hook.js');
  const hookCode = fs.readFileSync(hookPath, 'utf8');
  webFrame.executeJavaScript(hookCode, false).catch((err) => {
    console.error('[OmeTroll] Failed to inject slot-hook:', err);
  });
} catch (err) {
  console.error('[OmeTroll] Error reading slot-hook.js:', err);
}
