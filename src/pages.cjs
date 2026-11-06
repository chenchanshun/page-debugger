const { WebContentsView, session } = require('electron');
const { PageRecorder } = require('./recorder.cjs');
const { id, normalizeUrl, httpError, boundedText } = require('./utils.cjs');

class PageManager {
  constructor(window, workspace, store, cdpEndpoint, notify) {
    Object.assign(this, { window, workspace, store, cdpEndpoint, notify });
    this.pages = new Map(); this.overlay = false; this.stopping = false;
  }
  get(pageId) {
    const page = this.pages.get(pageId);
    if (!page || page.closing || page.view.webContents.isDestroyed()) throw httpError(404, '页面已关闭或不存在');
    return page;
  }
  describe(page) {
    const contents = page.view.webContents;
    return { id: page.id, profileId: page.profileId, targetId: page.targetId, url: contents.getURL() || page.url,
      title: page.title || '新标签页', loading: contents.isLoading(), canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(), error: page.error, capture: page.recorder?.status ?? 'connecting',
      captureError: page.recorder?.lastError ?? null,
      active: this.workspace.state.activePageId === page.id,
      webSocketDebuggerUrl: page.targetId ? `ws://127.0.0.1:${new URL(this.cdpEndpoint).port}/devtools/page/${page.targetId}` : null };
  }
  list() { return [...this.pages.values()].filter(page => !page.closing && !page.view.webContents.isDestroyed()).map(page => this.describe(page)); }
  async cookieConnection(profileId) {
    let page = [...this.pages.values()].find(item => item.profileId === profileId && !item.closing && !item.view.webContents.isDestroyed());
    if (!page) { const created = await this.create({ profileId, activate: false }); page = this.get(created.id); }
    if (page.recorder.status !== 'recording') throw httpError(503, '此环境的调试连接尚未就绪，请稍后重试');
    return page.recorder.cdp;
  }
  async restore() {
    const saved = [...this.workspace.state.tabs]; const active = this.workspace.state.activePageId;
    this.workspace.state.tabs = [];
    for (const tab of saved) {
      try { await this.create({ ...tab, activate: false }); }
      catch (error) { this.store.upsert('event', tab.id, { id: id('event'), startedAt: new Date().toISOString(), type: 'restore-failed', message: error.message }); }
    }
    if (!this.pages.size) await this.create({ profileId: this.workspace.state.profiles[0].id, activate: false });
    await this.select(this.pages.has(active) ? active : this.pages.keys().next().value);
  }
  async create(input = {}) {
    const profile = this.workspace.getProfile(input.profileId ?? this.workspace.state.profiles[0].id);
    const url = normalizeUrl(input.url); const pageId = input.id ?? id('page');
    const partition = `persist:${profile.id}`;
    const profileSession = session.fromPartition(partition);
    profileSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    profileSession.setPermissionCheckHandler(() => false);
    const view = new WebContentsView({ webPreferences: {
      partition, nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true,
      backgroundThrottling: false, webSecurity: true, spellcheck: false
    } });
    view.setBackgroundColor('#ffffff'); view.setVisible(false); this.window.contentView.addChildView(view);
    const page = { id: pageId, profileId: profile.id, view, url, title: '新标签页', error: null, closing: false };
    this.pages.set(pageId, page);
    this.installHandlers(page);
    page.recorder = new PageRecorder(page, this.store, this.cdpEndpoint, this.notify);
    try {
      await view.webContents.loadURL('about:blank');
      await page.recorder.start();
      this.workspace.state.tabs.push({ id: pageId, profileId: profile.id, url }); await this.workspace.save();
      if (input.activate !== false) await this.select(pageId);
      // Recording is attached before navigation; creation returns without waiting for a slow website.
      this.load(page, url); this.notify(); return this.describe(page);
    } catch (error) {
      await page.recorder.stop(); this.pages.delete(pageId); view.webContents.close({ waitForBeforeUnload: false }); throw error;
    }
  }
  installHandlers(page) {
    const contents = page.view.webContents;
    const update = () => { if (!this.stopping && !contents.isDestroyed()) this.notify(); };
    contents.on('page-title-updated', (_event, title) => { page.title = title; update(); });
    contents.on('did-start-loading', update); contents.on('did-stop-loading', update);
    contents.on('did-navigate', (_event, url) => this.rememberUrl(page, url));
    contents.on('did-navigate-in-page', (_event, url, mainFrame) => { if (mainFrame) this.rememberUrl(page, url); });
    contents.on('did-fail-load', (_event, code, description, failedUrl, mainFrame) => {
      if (mainFrame && code !== -3) { page.error = `${description} (${code})`; page.url = failedUrl || page.url; update(); }
    });
    contents.on('will-navigate', (event, url) => { try { normalizeUrl(url); } catch { event.preventDefault(); } });
    contents.on('will-redirect', (event, url) => { try { normalizeUrl(url); } catch { event.preventDefault(); } });
    contents.setWindowOpenHandler(({ url }) => {
      try { const target = normalizeUrl(url); void this.create({ profileId: page.profileId, url: target }).catch(error => { page.error = error.message; update(); }); } catch {}
      return { action: 'deny' };
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') { event.preventDefault(); this.devtools(page.id); }
    });
    contents.on('render-process-gone', (_event, details) => { page.error = `页面进程已退出：${details.reason}`; update(); });
  }
  rememberUrl(page, url) {
    if (this.stopping || page.closing) return;
    page.url = url; page.error = null; this.layout();
    const saved = this.workspace.state.tabs.find(tab => tab.id === page.id); if (saved) saved.url = url;
    void this.workspace.save().catch(error => { page.error = error.message; this.notify(); }); this.notify();
  }
  load(page, url) {
    page.error = null; page.url = url; this.layout();
    void page.view.webContents.loadURL(url).catch(error => { if (error.code !== 'ERR_ABORTED' && !page.closing) { page.error = error.message; this.notify(); } });
  }
  async navigate(pageId, url) { const page = this.get(pageId); this.load(page, normalizeUrl(url)); return this.describe(page); }
  async select(pageId) {
    this.get(pageId); this.workspace.state.activePageId = pageId; this.layout(); await this.workspace.save(); this.notify();
  }
  layout() {
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    for (const page of this.pages.values()) {
      const visible = !this.overlay && this.workspace.state.activePageId === page.id && page.url !== 'about:blank';
      page.view.setBounds({ x: 232, y: 138, width: Math.max(1, width - 232), height: Math.max(1, height - 178) });
      page.view.setVisible(visible);
    }
  }
  setOverlay(visible) { this.overlay = Boolean(visible); this.layout(); }
  devtools(pageId) { this.get(pageId).view.webContents.openDevTools({ mode: 'detach', activate: true }); }
  history(pageId, direction) {
    const contents = this.get(pageId).view.webContents;
    if (direction === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    if (direction === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    if (direction === 'reload') contents.reload();
    if (direction === 'stop') contents.stop();
  }
  async closeProfilePages({ profileId, keepPageId }) {
    this.workspace.getProfile(profileId);
    if (keepPageId && this.get(keepPageId).profileId !== profileId) throw httpError(400, '保留的标签页不属于当前环境');
    const activeId = this.workspace.state.activePageId;
    const pages = [...this.pages.values()].filter(page => page.profileId === profileId && page.id !== keepPageId && !page.closing);
    // Close the active tab last so background cleanup does not switch tabs repeatedly.
    pages.sort((a, b) => Number(a.id === activeId) - Number(b.id === activeId));
    let closed = 0;
    for (const page of pages) {
      if (!this.pages.has(page.id) || page.closing) continue;
      await this.close(page.id, { stayInProfile: true }); closed++;
    }
    return { closed };
  }
  async close(pageId, { stayInProfile = false } = {}) {
    const page = this.get(pageId); page.closing = true; await page.recorder.stop();
    this.window.contentView.removeChildView(page.view); page.view.webContents.close({ waitForBeforeUnload: false }); this.pages.delete(pageId);
    this.workspace.state.tabs = this.workspace.state.tabs.filter(tab => tab.id !== pageId);
    if (this.workspace.state.activePageId === pageId) {
      const remaining = [...this.pages.values()].filter(item => !item.closing && !item.view.webContents.isDestroyed());
      this.workspace.state.activePageId = (remaining.find(item => item.profileId === page.profileId) ?? (stayInProfile ? null : remaining[0]))?.id ?? null;
    }
    await this.workspace.save(); this.layout(); this.notify();
  }
  async evaluate(pageId, input) {
    const page = this.get(pageId); const expression = String(input?.expression ?? '');
    if (!expression || Buffer.byteLength(expression) > 512 * 1024) throw httpError(400, '代码为空或超过 512 KiB');
    const startedAt = new Date().toISOString();
    const result = await page.recorder.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true,
      ...(input.contextId ? { contextId: input.contextId } : {}) }, input.sessionId, 30000);
    this.store.upsert('evaluation', pageId, { id: id('evaluation'), startedAt,
      expression: boundedText(expression, 65536).text, result: boundedText(JSON.stringify(result), 65536).text });
    return result;
  }
  async cdp(pageId, method, params = {}, sessionId) {
    if (typeof method !== 'string' || !/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) throw httpError(400, 'Invalid CDP method');
    return this.get(pageId).recorder.cdp.send(method, params, sessionId);
  }
  async screenshot(pageId) {
    const image = await this.get(pageId).view.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    if (image.isEmpty()) throw httpError(503, '页面暂时没有可截图的画面');
    return { data: image.toPNG().toString('base64'), format: 'png', ...image.getSize() };
  }
  async shutdown() {
    this.stopping = true;
    await Promise.allSettled([...this.pages.values()].map(page => page.recorder.stop()));
    await this.workspace.save(); await this.store.flush();
    for (const page of this.pages.values()) if (!page.view.webContents.isDestroyed()) page.view.webContents.close({ waitForBeforeUnload: false });
    this.pages.clear();
  }
}
module.exports = { PageManager };
