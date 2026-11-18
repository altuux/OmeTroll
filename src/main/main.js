const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');

const DEBUG_LOG_PATH = app.isPackaged
  ? path.join(app.getPath('userData'), 'popup-debug.log')
  : path.join(__dirname, '../../popup-debug.log');
try {
  fs.writeFileSync(DEBUG_LOG_PATH, `--- OmeTroll Debug Log (${new Date().toISOString()}) ---\n`);
} catch (_) {}

function logDebug(msg) {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${msg}\n`;
  console.log(line.trim());
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, line);
  } catch (_) {}
}

// Allow WebAudio & video autoplay without user gesture and ensure local WebRTC ICE works without mDNS issues
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const TOP_BAR_HEIGHT = 54;
const BOTTOM_DECK_HEIGHT = 340;
const DEFAULT_URL = 'https://ome.tv/';

let adminWindow = null;
let slotAView = null;
let slotBView = null;
let viewsVisible = true;

function getCleanUserAgent(slotId) {
  const defaultUA = app.userAgentFallback || '';
  let ua = defaultUA
    .replace(/\s*Electron\/[^\s]+/g, '')
    .replace(/\s*ometroll\/[^\s]+/gi, '');
  if (slotId === 'B') {
    ua = ua.replace(/Chrome\/\d+\.\d+\.\d+\.\d+/, 'Chrome/139.0.0.0');
  }
  return ua;
}

function setupSessionPermissions(ses, slotId) {
  ses.setUserAgent(getCleanUserAgent(slotId));

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'clipboard-read', 'fullscreen', 'pointerLock'];
    callback(allowed.includes(permission));
  });

  ses.setPermissionCheckHandler((_webContents, permission) => {
    const allowed = ['media', 'mediaKeySystem', 'clipboard-read', 'fullscreen', 'pointerLock'];
    return allowed.includes(permission);
  });

  // Strip COOP header so OAuth popups can postMessage back to window.opener
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'cross-origin-opener-policy') {
        delete headers[key];
      }
    }
    callback({ responseHeaders: headers });
  });
}

function updateViewBounds() {
  if (!adminWindow || !slotAView || !slotBView) return;
  const [winW, winH] = adminWindow.getContentSize();
  const viewH = Math.max(120, winH - TOP_BAR_HEIGHT - BOTTOM_DECK_HEIGHT);
  const halfW = Math.floor(winW / 2);

  slotAView.setBounds({
    x: 10,
    y: TOP_BAR_HEIGHT,
    width: Math.max(200, halfW - 15),
    height: viewH
  });

  slotBView.setBounds({
    x: halfW + 5,
    y: TOP_BAR_HEIGHT,
    width: Math.max(200, winW - halfW - 15),
    height: viewH
  });
}

function createSlotView(slotId, partitionName) {
  const ses = session.fromPartition(partitionName);
  setupSessionPermissions(ses, slotId);

  const view = new WebContentsView({
    webPreferences: {
      partition: partitionName,
      preload: path.join(__dirname, '../preload/slot-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--ometroll-slot=${slotId}`]
    }
  });

  // Mute direct tab speaker output so Admin GUI controls what you hear (monitoring)
  view.webContents.setAudioMuted(true);

  // Forward keyDown events from focused slots so global/modifier keybinds work anywhere
  view.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && !input.isAutoRepeat) {
      adminWindow?.webContents.send('slot:keydown', {
        slotId,
        key: input.key,
        code: input.code,
        control: input.control,
        alt: input.alt,
        shift: input.shift,
        meta: input.meta
      });
    }
  });

  view.webContents.on('did-navigate', (_event, url) => {
    adminWindow?.webContents.send('slot:nav', { slotId, url });
  });

  view.webContents.on('did-navigate-in-page', (_event, url) => {
    adminWindow?.webContents.send('slot:nav', { slotId, url });
  });

  view.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 || /auth|login|oauth|token|opener|cookie|popup/i.test(message)) {
      logDebug(`[Slot ${slotId} console(${level})] ${message}`);
    }
  });

  // Allow popups (OAuth, Ome.TV login/rules dialogs) while preserving window.opener & slot session
  view.webContents.setWindowOpenHandler(({ url, frameName, disposition }) => {
    logDebug(`[Slot ${slotId} window.open] url=${url} frame=${frameName} disp=${disposition}`);
    if (/^(https?:|about:blank)/i.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 560,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: {
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      };
    }
    return { action: 'deny' };
  });

  view.webContents.on('did-create-window', (childWindow, details) => {
    logDebug(`[Slot ${slotId} did-create-window] url=${details.url} frame=${details.frameName}`);
    const wc = childWindow.webContents;
    wc.on('did-navigate', (_e, url) => logDebug(`[Slot ${slotId} popup did-navigate] ${url}`));
    wc.on('did-redirect-navigation', (_e, url) => logDebug(`[Slot ${slotId} popup redirect] ${url}`));
    wc.on('did-fail-load', (_e, code, desc, url) => logDebug(`[Slot ${slotId} popup fail-load] ${code} ${desc} ${url}`));
    wc.on('console-message', (_e, level, msg) => logDebug(`[Slot ${slotId} popup console(${level})] ${msg}`));
    childWindow.on('closed', () => logDebug(`[Slot ${slotId} popup closed]`));
  });

  view.webContents.loadURL(DEFAULT_URL);
  return view;
}

function createMainWindow() {
  setupSessionPermissions(session.defaultSession);

  adminWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: '#0b0e14',
    title: 'OmeTroll — MITM Video/Audio Control Deck',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/admin-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  adminWindow.loadFile(path.join(__dirname, '../renderer/admin/index.html'));

  slotAView = createSlotView('A', 'persist:slot-a');
  slotBView = createSlotView('B', 'persist:slot-b');

  adminWindow.contentView.addChildView(slotAView);
  adminWindow.contentView.addChildView(slotBView);

  updateViewBounds();
  adminWindow.on('resize', updateViewBounds);

  adminWindow.on('closed', () => {
    adminWindow = null;
    slotAView = null;
    slotBView = null;
  });
}

function getSlotIdBySender(sender) {
  if (slotAView && sender.id === slotAView.webContents.id) return 'A';
  if (slotBView && sender.id === slotBView.webContents.id) return 'B';
  return null;
}

function getViewsForTarget(target) {
  const list = [];
  if ((target === 'A' || target === 'both') && slotAView) list.push({ id: 'A', view: slotAView });
  if ((target === 'B' || target === 'both') && slotBView) list.push({ id: 'B', view: slotBView });
  return list;
}

// --- IPC Signaling & Control ---
ipcMain.on('slot:signal', (event, payload) => {
  const slotId = getSlotIdBySender(event.sender);
  if (!slotId || !adminWindow) return;
  adminWindow.webContents.send('slot:signal', { slotId, payload });
});

ipcMain.on('slot:status', (event, status) => {
  const slotId = getSlotIdBySender(event.sender);
  if (!slotId || !adminWindow) return;
  adminWindow.webContents.send('slot:status', { slotId, status });
});

ipcMain.on('admin:signal', (_event, { slotId, payload }) => {
  const view = slotId === 'A' ? slotAView : slotId === 'B' ? slotBView : null;
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.send('admin:signal', payload);
  }
});

ipcMain.handle('admin:load-url', async (_event, { target, url }) => {
  let finalUrl = url.trim();
  if (!/^https?:\/\//i.test(finalUrl)) {
    finalUrl = 'https://' + finalUrl;
  }
  for (const { view } of getViewsForTarget(target)) {
    view.webContents.loadURL(finalUrl);
  }
  return finalUrl;
});

ipcMain.handle('admin:reload', async (_event, { target }) => {
  for (const { view } of getViewsForTarget(target)) {
    view.webContents.reloadIgnoringCache();
  }
});

ipcMain.on('admin:dom-action', (_event, { target, action }) => {
  for (const { view } of getViewsForTarget(target)) {
    view.webContents.send('admin:signal', { type: 'dom-action', action });
  }
});

const MYINSTANTS_CATEGORIES = {
  sfx: 'https://www.myinstants.com/en/categories/sound%20effects/ca/',
  memes: 'https://www.myinstants.com/en/categories/memes/',
  viral: 'https://www.myinstants.com/en/trending/',
  games: 'https://www.myinstants.com/en/categories/games/'
};

ipcMain.handle('admin:fetch-myinstants', async (_event, arg) => {
  const query = typeof arg === 'string' ? arg : arg?.query || '';
  const category = typeof arg === 'object' && arg?.category ? arg.category : 'sfx';
  const q = query.trim();
  const targetUrl = q
    ? `https://www.myinstants.com/en/search/?name=${encodeURIComponent(q)}`
    : MYINSTANTS_CATEGORIES[category] || MYINSTANTS_CATEGORIES.sfx;
  const res = await fetch(targetUrl, {
    headers: { 'User-Agent': getCleanUserAgent() }
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const matches = [...html.matchAll(/play\('([^']+)'.*?title="Play ([^"]+) sound"/gs)];
  const seen = new Set();
  const results = [];
  for (const m of matches) {
    const soundUrl = m[1];
    const name = m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    if (!seen.has(soundUrl)) {
      seen.add(soundUrl);
      results.push({ name, url: soundUrl });
    }
  }
  return results.slice(0, 40);
});

ipcMain.handle('admin:fetch-audio', async (_event, soundPath) => {
  const fullUrl = soundPath.startsWith('http') ? soundPath : `https://www.myinstants.com${soundPath}`;
  const res = await fetch(fullUrl, {
    headers: { 'User-Agent': getCleanUserAgent() }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
});

ipcMain.on('admin:set-views-visible', (_event, visible) => {
  viewsVisible = Boolean(visible);
  slotAView?.setVisible(viewsVisible);
  slotBView?.setVisible(viewsVisible);
});

ipcMain.handle('admin:set-proxy', async (_event, { slotId, proxyRules }) => {
  const partitionName = slotId === 'A' ? 'persist:slot-a' : 'persist:slot-b';
  const ses = session.fromPartition(partitionName);
  const rules = (proxyRules || '').trim();
  if (!rules) {
    await ses.setProxy({ mode: 'direct' });
    return { ok: true, mode: 'direct' };
  }
  await ses.setProxy({ proxyRules: rules });
  return { ok: true, mode: 'fixed_servers', proxyRules: rules };
});

ipcMain.handle('admin:clear-session', async (_event, { slotId }) => {
  const partitionName = slotId === 'A' ? 'persist:slot-a' : 'persist:slot-b';
  const ses = session.fromPartition(partitionName);
  await ses.clearStorageData();
  const view = slotId === 'A' ? slotAView : slotBView;
  view?.webContents.reloadIgnoringCache();
  return { ok: true };
});

ipcMain.on('admin:open-devtools', (_event, target) => {
  if (target === 'admin') {
    adminWindow?.webContents.openDevTools({ mode: 'detach' });
  } else if (target === 'A') {
    slotAView?.webContents.openDevTools({ mode: 'detach' });
  } else if (target === 'B') {
    slotBView?.webContents.openDevTools({ mode: 'detach' });
  }
});

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
