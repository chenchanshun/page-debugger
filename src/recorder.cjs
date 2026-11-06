const { CdpConnection } = require('./cdp.cjs');
const { id, boundedText } = require('./utils.cjs');

const BODY_LIMIT = 1024 * 1024;
class PageRecorder {
  constructor(page, store, endpoint, onChange) {
    this.page = page; this.store = store; this.endpoint = endpoint; this.onChange = onChange;
    this.requests = new Map(); this.extra = new Map(); this.childSessions = new Set(); this.tasks = new Set();
    this.status = 'connecting'; this.lastError = null; this.stopped = false; this.reconnectTimer = null; this.cdp = null;
  }
  async start() {
    const contents = this.page.view.webContents;
    if (typeof contents.getOrCreateDevToolsTargetId === 'function') this.page.targetId = contents.getOrCreateDevToolsTargetId();
    else {
      const attached = contents.debugger.isAttached();
      if (!attached) contents.debugger.attach('1.3');
      try { this.page.targetId = (await contents.debugger.sendCommand('Target.getTargetInfo')).targetInfo.targetId; }
      finally { if (!attached) contents.debugger.detach(); }
    }
    const cdp = await CdpConnection.connect(`ws://127.0.0.1:${new URL(this.endpoint).port}/devtools/page/${this.page.targetId}`);
    if (this.stopped) { cdp.close(); return; }
    this.cdp = cdp;
    cdp.on('event', (method, params, sessionId) => this.handle(method, params, sessionId));
    cdp.on('transport-error', error => { this.lastError = error.message; });
    cdp.on('disconnected', () => {
      if (this.stopped || this.cdp !== cdp) return;
      this.status = 'reconnecting'; this.lastError = '记录连接中断；中断期间的事件无法补录'; this.onChange();
      this.event('capture-gap', this.lastError);
      this.requests.clear(); this.extra.clear(); this.childSessions.clear();
      this.reconnectTimer = setTimeout(() => { this.track(this.reconnect()); }, 1000);
    });
    await this.enable(); this.status = 'recording'; this.lastError = null; this.onChange();
  }
  async reconnect() {
    try { await this.start(); } catch (error) {
      this.lastError = error.message;
      if (!this.stopped) this.reconnectTimer = setTimeout(() => this.track(this.reconnect()), 2000);
    }
  }
  async enable(sessionId) {
    await this.cdp.send('Network.enable', { maxTotalBufferSize: 16 * 1024 * 1024, maxResourceBufferSize: 2 * BODY_LIMIT, maxPostDataSize: 65536 }, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    await this.cdp.send('Page.enable', {}, sessionId).catch(() => {});
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
  }
  track(promise) {
    this.tasks.add(promise);
    promise.catch(error => { if (!this.stopped) { this.lastError = error.message; this.onChange(); } }).finally(() => this.tasks.delete(promise));
  }
  event(type, message) {
    this.store.upsert('event', this.page.id, { id: id('event'), startedAt: new Date().toISOString(), type, message });
  }
  write(record) { this.store.upsert('network', this.page.id, record); }
  handle(method, params, sessionId) {
    if (this.stopped) return;
    if (method === 'Target.attachedToTarget') {
      this.childSessions.add(params.sessionId);
      this.track(this.enable(params.sessionId)); return;
    }
    if (method === 'Target.detachedFromTarget') { this.childSessions.delete(params.sessionId); return; }
    const key = `${sessionId ?? 'main'}:${params.requestId}`;
    if (method === 'Network.requestWillBeSent') {
      const previous = this.requests.get(key);
      if (previous && params.redirectResponse) {
        Object.assign(previous, { status: params.redirectResponse.status, responseHeaders: params.redirectResponse.headers,
          state: 'redirected', finishedAt: new Date().toISOString(), redirectTo: params.request.url });
        this.write(previous);
      }
      const post = boundedText(params.request.postData ?? '', 65536);
      const record = { id: id('request'), requestId: params.requestId, sessionId: sessionId ?? null,
        startedAt: new Date(params.wallTime * 1000).toISOString(), timestamp: params.timestamp,
        method: params.request.method, url: params.request.url, resourceType: params.type,
        requestHeaders: this.extra.get(key)?.requestHeaders ?? params.request.headers,
        ...(post.text ? { postData: post.text, postDataTruncated: post.truncated } : {}),
        ...(params.request.hasPostData && !post.text ? { postDataUnavailable: true } : {}),
        initiator: params.initiator, frameId: params.frameId, state: 'pending',
        ...(previous && params.redirectResponse ? { redirectedFrom: previous.id } : {}) };
      this.requests.delete(key); this.requests.set(key, record); this.extra.delete(key);
      while (this.requests.size > 2500) this.requests.delete(this.requests.keys().next().value);
      this.write(record); return;
    }
    const record = this.requests.get(key);
    if (method === 'Network.requestWillBeSentExtraInfo' || method === 'Network.responseReceivedExtraInfo') {
      const update = method.includes('requestWill') ? { requestHeaders: params.headers } : { responseHeaders: params.headers };
      if (record) { Object.assign(record, update); this.write(record); }
      else { this.extra.set(key, { ...this.extra.get(key), ...update }); if (this.extra.size > 500) this.extra.delete(this.extra.keys().next().value); }
      return;
    }
    if (method === 'Network.responseReceived' && record) {
      Object.assign(record, { status: params.response.status, statusText: params.response.statusText, mimeType: params.response.mimeType,
        responseHeaders: params.response.headers, protocol: params.response.protocol, fromDiskCache: params.response.fromDiskCache,
        fromServiceWorker: params.response.fromServiceWorker, timing: params.response.timing, state: 'receiving' });
      this.write(record); return;
    }
    if (method === 'Network.loadingFailed' && record) {
      Object.assign(record, { state: 'failed', error: params.errorText, canceled: params.canceled, finishedAt: new Date().toISOString() });
      this.requests.delete(key); this.write(record); return;
    }
    if (method === 'Network.loadingFinished' && record) {
      Object.assign(record, { state: 'finished', encodedBytes: params.encodedDataLength,
        durationMs: Math.max(0, (params.timestamp - record.timestamp) * 1000), finishedAt: new Date().toISOString() });
      this.requests.delete(key); this.track(this.finish(record, sessionId)); return;
    }
    if (method === 'Runtime.consoleAPICalled') {
      const message = boundedText(params.args.map(arg => arg.value !== undefined ?
        (typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value)) : arg.description ?? arg.type).join(' '), 32768);
      this.store.upsert('console', this.page.id, { id: id('console'), startedAt: new Date(params.timestamp).toISOString(),
        level: params.type, message: message.text, truncated: message.truncated, executionContextId: params.executionContextId,
        sessionId: sessionId ?? null, stackTrace: params.stackTrace }); return;
    }
    if (method === 'Runtime.exceptionThrown') {
      this.store.upsert('console', this.page.id, { id: id('console'), startedAt: new Date(params.timestamp).toISOString(),
        level: 'error', message: boundedText(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text, 32768).text,
        stackTrace: params.exceptionDetails.stackTrace });
    }
    if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived' || method === 'Network.eventSourceMessageReceived') {
      const payload = boundedText(params.response?.payloadData ?? params.data ?? '', 65536);
      this.store.upsert('event', this.page.id, { id: id('event'), startedAt: new Date().toISOString(), type: method,
        requestId: params.requestId, sessionId: sessionId ?? null, message: payload.text, truncated: payload.truncated });
    }
  }
  async finish(record, sessionId) {
    if (record.encodedBytes > 2 * BODY_LIMIT) record.bodyUnavailable = '超过响应体采集上限';
    else {
      try {
        const result = await this.cdp.send('Network.getResponseBody', { requestId: record.requestId }, sessionId);
        const body = boundedText(result.body, result.base64Encoded ? Math.floor(BODY_LIMIT / 3) * 4 : BODY_LIMIT);
        record.body = { text: body.text, base64Encoded: result.base64Encoded, truncated: body.truncated, originalBytes: body.originalBytes };
      } catch (error) { record.bodyUnavailable = error.message; }
    }
    if (this.store.get(record.id)) this.write(record);
  }
  async stop() {
    this.stopped = true; clearTimeout(this.reconnectTimer);
    for (const record of this.requests.values()) { record.state = 'interrupted'; record.finishedAt = new Date().toISOString(); this.write(record); }
    this.requests.clear(); this.cdp?.close(); await Promise.allSettled([...this.tasks]);
    this.status = 'stopped';
  }
}
module.exports = { PageRecorder };
