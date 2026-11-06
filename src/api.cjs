const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { httpError } = require('./utils.cjs');

function tokenMatches(actual, expected) {
  const a = Buffer.from(actual ?? ''); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readBody(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 5 * 1024 * 1024) throw httpError(413, '请求体超过 5 MiB'); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'JSON 格式错误'); }
}
function createApi(host, token) {
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
    const send = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      // No browser-origin requests or permissive CORS: page JS cannot call the host API.
      if (request.headers.origin) throw httpError(403, 'Browser-origin requests are not accepted');
      if (!/^127\.0\.0\.1(?::\d+)?$/.test(request.headers.host ?? '')) throw httpError(403, 'Invalid Host');
      if (url.pathname === '/health' && request.method === 'GET') return send(200, { ok: true, app: 'page-debugger', version: host.version });
      if (!tokenMatches(request.headers.authorization?.replace(/^Bearer /, ''), token)) throw httpError(401, '需要本机 connection.json 中的 API token');
      const query = Object.fromEntries(url.searchParams);
      const method = request.method;
      const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(request) : {};
      let result;
      if (method === 'GET' && url.pathname === '/v1/status') result = host.state();
      else if (method === 'GET' && url.pathname === '/v1/profiles') result = host.workspace.state.profiles;
      else if (method === 'POST' && url.pathname === '/v1/profiles') { result = await host.workspace.createProfile(body); host.notify(); }
      else if (method === 'POST' && /^\/v1\/profiles\/[\w-]+\/cookies\/import$/.test(url.pathname)) result = await host.cookieImporter.import(url.pathname.split('/')[3], body.cookies);
      else if (method === 'GET' && url.pathname === '/v1/pages') result = host.pages.list();
      else if (method === 'POST' && url.pathname === '/v1/pages') result = await host.pages.create({ profileId: body.profileId, url: body.url, activate: body.activate });
      else if (method === 'GET' && url.pathname === '/v1/records') result = host.store.list({ ...query, includeBodies: query.includeBodies === 'true' });
      else if (method === 'GET' && url.pathname === '/v1/captures') result = await host.store.archives();
      else if (method === 'GET' && /^\/v1\/captures\/run_[\w-]+\/records$/.test(url.pathname)) result = await host.store.archiveRecords(url.pathname.split('/')[3], query);
      else if (method === 'GET' && /^\/v1\/records\/[\w-]+$/.test(url.pathname)) { result = host.store.get(url.pathname.split('/')[3]); if (!result) throw httpError(404, '记录已过期或不存在'); }
      else if (url.pathname.startsWith('/v1/pages/')) result = await pageRoute(host, method, url.pathname, body);
      else if (method === 'POST' && url.pathname === '/v1/window') { host.windowAction(body.action); result = { visible: host.window.isVisible() }; }
      else if (method === 'GET' && url.pathname === '/v1/window/screenshot') {
        const image = await host.window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        result = { data: image.toPNG().toString('base64'), ...image.getSize() };
      }
      else if (method === 'POST' && url.pathname === '/v1/quit') { result = { quitting: true }; setTimeout(() => host.quit(), 100); }
      else throw httpError(404, '接口不存在');
      send(200, { ok: true, data: result ?? null });
    } catch (error) { send(error.status ?? 500, { ok: false, error: error.message }); }
  });
  server.requestTimeout = 35000; server.headersTimeout = 10000;
  return server;
}
async function pageRoute(host, method, pathname, body) {
  const parts = pathname.split('/'); const pageId = parts[3]; const action = parts[4];
  if (parts.length > 5) throw httpError(404, '接口不存在');
  if (method === 'DELETE' && !action) { await host.pages.close(pageId); return { closed: true }; }
  if (method === 'GET' && !action) return host.pages.describe(host.pages.get(pageId));
  if (method === 'POST' && action === 'navigate') return host.pages.navigate(pageId, body.url);
  if (method === 'POST' && action === 'select') { await host.pages.select(pageId); return { selected: true }; }
  if (method === 'POST' && ['reload', 'back', 'forward', 'stop'].includes(action)) { host.pages.history(pageId, action); return { accepted: true }; }
  if (method === 'POST' && action === 'evaluate') return host.pages.evaluate(pageId, body);
  if (method === 'POST' && action === 'cdp') return host.pages.cdp(pageId, body.method, body.params, body.sessionId);
  if (method === 'GET' && action === 'screenshot') return host.pages.screenshot(pageId);
  if (method === 'GET' && action === 'resources') return host.pages.cdp(pageId, 'Page.getResourceTree');
  throw httpError(404, '接口不存在');
}
module.exports = { createApi, tokenMatches };
