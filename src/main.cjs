const { app, BrowserWindow, ipcMain, clipboard, shell, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { availablePort, atomicJson, httpError } = require('./utils.cjs');
const { Workspace } = require('./workspace.cjs');
const { CaptureStore } = require('./capture-store.cjs');
const { PageManager } = require('./pages.cjs');
const { createApi } = require('./api.cjs');
const { CookieImporter } = require('./cookie-importer.cjs');
const { createWindowTray, showWindow } = require('./window-tray.cjs');

app.setName('PageDebugger');
const dataDirectory = process.env.PAGE_DEBUGGER_DATA_DIR || path.join(app.getPath('appData'), 'PageDebugger');
app.setPath('userData', dataDirectory);
const hidden = process.argv.includes('--hidden');
let host, descriptorPath, closing = false, allowQuit = false, noticeTimer;
if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  app.on('second-instance', () => { if (host?.window) showWindow(host.window); });
  boot().catch(async error => {
    console.error('Page Debugger startup failed:', error.message);
    try { await atomicJson(path.join(dataDirectory, 'startup-error.json'), { time: new Date().toISOString(), message: error.message }); } catch {}
    app.exit(1);
  });
}

async function boot() {
  const cdpPort = await availablePort(Number(process.env.PAGE_DEBUGGER_CDP_PORT) || 0);
  app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  await app.whenReady();
  const workspace = new Workspace(dataDirectory); await workspace.load();
  const store = new CaptureStore(dataDirectory); await store.initialize();
  const window = new BrowserWindow({ width: 1440, height: 940, minWidth: 960, minHeight: 640, show: false,
    title: 'Page Debugger', icon: path.join(__dirname, 'assets', 'app.ico'), backgroundColor: '#f5f7fa', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.setMenuBarVisibility(false);
  const token = randomBytes(32).toString('hex');
  host = { version: app.getVersion(), window, workspace, store, cdpEndpoint: `http://127.0.0.1:${cdpPort}`, notify, quit: () => app.quit(),
    windowAction(action) {
      if (action === 'show') showWindow(window);
      else if (action === 'hide') window.hide();
      else throw httpError(400, '窗口操作只支持 show 或 hide');
      notify();
    },
    state() { return { version: host.version, profiles: workspace.state.profiles, pages: host.pages?.list() ?? [],
      activePageId: workspace.state.activePageId, connection: { apiEndpoint: host.apiEndpoint, cdpEndpoint: host.cdpEndpoint, descriptorPath },
      capture: store.summary(), visible: window.isVisible(), trayAvailable: host.tray?.available() ?? false }; }
  };
  host.tray = createWindowTray({ window, onQuit: () => app.quit() });
  window.on('close', event => {
    if (closing || allowQuit || !host.tray.available()) return;
    event.preventDefault();
    window.hide();
  });
  host.pages = new PageManager(window, workspace, store, host.cdpEndpoint, notify);
  host.cookieImporter = new CookieImporter({ validateProfile: profileId => workspace.getProfile(profileId),
    getConnection: profileId => host.pages.cookieConnection(profileId),
    flushCookies: profileId => session.fromPartition(`persist:${profileId}`).cookies.flushStore() });
  const api = createApi(host, token);
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(Number(process.env.PAGE_DEBUGGER_API_PORT) || 0, '127.0.0.1', resolve); });
  host.api = api; host.apiEndpoint = `http://127.0.0.1:${api.address().port}`;
  descriptorPath = path.join(dataDirectory, 'connection.json');
  host.descriptor = { app: 'page-debugger', version: host.version, pid: process.pid, startedAt: new Date().toISOString(),
    apiEndpoint: host.apiEndpoint, cdpEndpoint: host.cdpEndpoint, apiToken: token, dataDirectory, descriptorPath };
  await waitForCdp(host.cdpEndpoint);
  installIpc();
  window.on('resize', () => host.pages.layout());
  window.on('show', notify); window.on('hide', notify);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  await window.loadFile(path.join(__dirname, 'ui', 'index.html'));
  await host.pages.restore();
  await atomicJson(descriptorPath, host.descriptor);
  if (!app.isPackaged) await atomicJson(path.join(__dirname, '..', '.local', 'connection.json'), host.descriptor);
  if (!hidden) window.showInactive();
  console.log(`Page Debugger ready. Connection descriptor: ${descriptorPath}`);
  notify();
}
function notify() {
  if (closing || noticeTimer || !host) return;
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    if (!closing && !host.window.isDestroyed() && !host.window.webContents.isDestroyed()) host.window.webContents.send('workspace:state', host.state());
  }, 70);
}
async function waitForCdp(endpoint) {
  for (let i = 0; i < 60; i++) {
    try { const result = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) }); if (result.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Chromium CDP endpoint did not start');
}
function installIpc() {
  ipcMain.handle('workspace:action', async (event, action, input = {}) => {
    if (event.sender !== host.window.webContents || event.senderFrame !== host.window.webContents.mainFrame) throw new Error('Untrusted IPC sender');
    try { return { ok: true, data: await uiAction(action, input) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
async function uiAction(action, input) {
  if (action === 'state') return host.state();
  if (action === 'create-profile') { const profile = await host.workspace.createProfile(input); notify(); return profile; }
  if (action === 'import-cookies') return host.cookieImporter.import(input.profileId, input.cookies);
  if (action === 'create-page') return host.pages.create({ profileId: input.profileId, url: input.url });
  if (action === 'select-page') return host.pages.select(input.pageId);
  if (action === 'close-page') return host.pages.close(input.pageId);
  if (action === 'close-profile-pages') return host.pages.closeProfilePages(input);
  if (action === 'navigate') return host.pages.navigate(input.pageId, input.url);
  if (['back', 'forward', 'reload', 'stop'].includes(action)) return host.pages.history(input.pageId, action);
  if (action === 'overlay') return host.pages.setOverlay(input.visible);
  if (action === 'devtools') return host.pages.devtools(input.pageId);
  if (action === 'copy-connection') { clipboard.writeText(JSON.stringify({ ...host.descriptor, pages: host.pages.list() }, null, 2)); return true; }
  if (action === 'hide') return host.windowAction('hide');
  if (action === 'records') return host.store.list({ pageId: input.pageId, kind: input.kind, search: input.search, limit: 200 });
  if (action === 'record') return host.store.get(input.recordId);
  if (action === 'evaluate') return host.pages.evaluate(input.pageId, { expression: input.expression });
  if (action === 'data-folder') return shell.openPath(dataDirectory);
  if (action === 'export') {
    const records = host.store.list({ pageId: input.pageId, limit: 2000, includeBodies: true });
    const filename = path.join(dataDirectory, 'exports', `capture-${Date.now()}.json`);
    await atomicJson(filename, { exportedAt: new Date().toISOString(), pages: host.pages.list(), records });
    return { filename, records: records.length };
  }
  throw httpError(400, '未知操作');
}
app.on('before-quit', event => {
  if (allowQuit) return;
  event.preventDefault();
  if (closing) return;
  closing = true; clearTimeout(noticeTimer);
  void (async () => {
    try {
      host?.api?.close(); host?.tray?.destroy(); await host?.pages?.shutdown();
      if (descriptorPath) {
        try { const current = JSON.parse(await fs.readFile(descriptorPath, 'utf8')); if (current.pid === process.pid) await fs.rm(descriptorPath, { force: true }); } catch {}
      }
    } finally { allowQuit = true; app.quit(); }
  })();
});
app.on('window-all-closed', () => app.quit());
