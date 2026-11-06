const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.local', `integration-${Date.now()}`);
let child, connection, browser, fixture;
const checks = [];
async function waitUntil(check, label, timeout = 25000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ''}`);
}
async function request(method, route, data) {
  const response = await fetch(`${connection.apiEndpoint}${route}`, { method,
    headers: { Authorization: `Bearer ${connection.apiToken}`, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(35000) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`${route}: ${result.error}`);
  return result.data;
}
function check(name) { checks.push(name); console.log(`PASS ${name}`); }
async function launch() {
  const env = { ...process.env, PAGE_DEBUGGER_DATA_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv.includes('--packaged');
  const executable = packaged ? path.join(root, 'dist', 'PageDebugger-win32-x64', 'PageDebugger.exe') : require('electron');
  child = spawn(executable, [...(packaged ? [] : [root]), '--hidden'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  child.stdout.on('data', data => output.push(data.toString())); child.stderr.on('data', data => output.push(data.toString()));
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`Electron exited (${child.exitCode}): ${output.join('').slice(-4000)}`);
    const candidate = JSON.parse(await fs.readFile(path.join(directory, 'connection.json'), 'utf8'));
    if (candidate.pid !== child.pid) return false;
    connection = candidate; return Boolean(await request('GET', '/v1/status'));
  }, 'client ready');
  return output;
}
async function stop() {
  const exiting = once(child, 'exit'); await request('POST', '/v1/quit', {});
  await Promise.race([exiting, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Graceful quit timed out')), 15000); timer.unref(); })]);
}
async function startFixture() {
  fixture = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/login') { res.setHeader('Set-Cookie', 'debug_session=synthetic-session; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax'); res.end('signed in'); return; }
    if (url.pathname === '/api/whoami') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ cookie: req.headers.cookie || '' })); return; }
    if (url.pathname === '/api/agents') {
      let body = ''; for await (const chunk of req) body += chunk;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, data: { total: 2, list: [{ agentCode: 'agent_test_1', agentName: 'Alpha' }, { agentCode: 'agent_test_2', agentName: 'Beta' }] }, received: body })); return;
    }
    if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/api/whoami' }); res.end(); return; }
    if (url.pathname === '/large') { res.setHeader('Content-Type', 'text/plain'); res.end('x'.repeat(3 * 1024 * 1024)); return; }
    if (url.pathname === '/frame') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Child frame</title><script>console.log("frame-ready");fetch("/api/whoami")</script>'); return; }
    if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('window.fixtureLoaded = true; console.log("fixture-ready");'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><title>Debug fixture</title></head><body style="font:16px Segoe UI;padding:50px;background:#f4f8ff"><h1>调试链路验收页面</h1><p>用于验证后台操作、会话隔离和真实网络记录。</p><input aria-label="Agent name" id="name"><button id="search">搜索 Agent</button><pre id="result"></pre><iframe src="/frame"></iframe><script src="/app.js"></script><script>document.querySelector('#search').onclick = async () => {const r=await fetch('/api/agents?name='+encodeURIComponent(document.querySelector('#name').value),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.querySelector('#name').value})});document.querySelector('#result').textContent=JSON.stringify(await r.json());};</script></body></html>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${fixture.address().port}`;
}
async function main() {
  await fs.mkdir(directory, { recursive: true }); const fixtureUrl = await startFixture();
  const output = await launch();
  let status = await request('GET', '/v1/status'); assert.equal(status.visible, false); check('hidden startup + authenticated API + discoverable CDP');
  assert.equal(status.trayAvailable, true);
  const profileId = status.profiles[0].id;
  const page = await request('POST', '/v1/pages', { profileId, url: fixtureUrl });
  browser = await chromium.connectOverCDP(connection.cdpEndpoint);
  const browserPage = await waitUntil(async () => {
    for (const context of browser.contexts()) for (const item of context.pages()) {
      if (item.url().startsWith(fixtureUrl) && (await item.title()) === 'Debug fixture') return item;
    }
  }, 'CDP maps real embedded page');
  await browserPage.getByRole('textbox', { name: 'Agent name' }).fill('Alpha');
  await browserPage.getByRole('button', { name: '搜索 Agent' }).click();
  await browserPage.locator('#result').filter({ hasText: 'agent_test_1' }).waitFor();
  const capture = await waitUntil(async () => {
    const records = await request('GET', `/v1/records?pageId=${page.id}&kind=network&includeBodies=true`);
    return records.find(record => record.url.includes('/api/agents') && record.body?.text.includes('agent_test_1'));
  }, 'capture response body');
  assert.equal(capture.method, 'POST'); assert.equal(capture.status, 200); assert.deepEqual(JSON.parse(capture.postData), { name: 'Alpha' });
  assert.equal(JSON.parse(capture.body.text).data.total, 2); assert.equal(capture.state, 'finished');
  assert.equal((await request('GET', '/v1/status')).visible, false);
  check('Playwright fills and clicks hidden embedded page; captures real POST and JSON response');
  const records = await request('GET', `/v1/records?pageId=${page.id}`);
  assert.ok(records.some(record => record.url === fixtureUrl + '/')); check('recorder attached before first navigation');
  const evaluation = await request('POST', `/v1/pages/${page.id}/evaluate`, { expression: 'Promise.resolve({title:document.title,bridge:typeof window.debugWorkspace,node:typeof require})' });
  assert.equal(evaluation.result.value.title, 'Debug fixture'); assert.equal(evaluation.result.value.bridge, 'undefined'); assert.equal(evaluation.result.value.node, 'undefined');
  check('page JavaScript evaluation works; remote page cannot access shell preload or Node');
  await request('POST', `/v1/pages/${page.id}/evaluate`, { expression: 'console.error("synthetic-console-error"); throw new Error("synthetic-page-exception")' });
  await waitUntil(async () => (await request('GET', `/v1/records?pageId=${page.id}&kind=console`)).some(record => record.message.includes('synthetic-console-error')), 'console captured');
  check('console logging and JavaScript exceptions return structured results');
  await request('POST', `/v1/pages/${page.id}/evaluate`, { expression: `fetch(${JSON.stringify(fixtureUrl + '/login')}).then(r=>r.text())` });
  const sibling = await request('POST', '/v1/pages', { profileId, url: fixtureUrl });
  await waitUntil(async () => (await request('GET', `/v1/pages/${sibling.id}`)).url.startsWith(fixtureUrl), 'same-profile tab loaded');
  const siblingCookie = await request('POST', `/v1/pages/${sibling.id}/evaluate`, { expression: 'fetch("/api/whoami").then(r=>r.json())' });
  assert.ok(siblingCookie.result.value.cookie.includes('synthetic-session'));
  const otherProfile = await request('POST', '/v1/profiles', { name: '隔离测试环境' });
  const isolated = await request('POST', '/v1/pages', { profileId: otherProfile.id, url: fixtureUrl });
  await waitUntil(async () => (await request('GET', `/v1/pages/${isolated.id}`)).url.startsWith(fixtureUrl), 'isolated tab loaded');
  const isolatedCookie = await request('POST', `/v1/pages/${isolated.id}/evaluate`, { expression: 'fetch("/api/whoami").then(r=>r.json())' });
  assert.equal(isolatedCookie.result.value.cookie, ''); check('same-profile tabs share login; different profiles isolate cookies');
  const cookieResult = await request('POST', `/v1/profiles/${profileId}/cookies/import`, { cookies: [
    { domain: '127.0.0.1', name: 'imported_host', value: 'synthetic-import', hostOnly: true, httpOnly: true, secure: false, sameSite: null, path: '/', session: false, expirationDate: Date.now() / 1000 + 86400.25, storeId: null },
    { domain: '.example.test', name: 'imported_domain', value: 'synthetic-domain', hostOnly: false, secure: true, sameSite: 'strict', path: '/', session: true },
    { domain: '.example.test', name: 'imported_partition', value: 'synthetic-partition', hostOnly: false, secure: true, httpOnly: true, sameSite: 'no_restriction', path: '/', session: false, expirationDate: Date.now() / 1000 + 86400, partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false } },
    { domain: '127.0.0.1', name: 'imported_host', value: 'expired-value', hostOnly: true, path: '/', expirationDate: 1 }
  ] });
  assert.equal(cookieResult.imported, 3); assert.equal(cookieResult.partitioned, 1); assert.equal(cookieResult.skipped, 1);
  assert.equal(cookieResult.failed, 0); assert.equal(cookieResult.persistenceError, null);
  assert.equal(JSON.stringify(cookieResult).includes('synthetic-import'), false);
  const storedCookies = (await request('POST', `/v1/pages/${page.id}/cdp`, { method: 'Network.getAllCookies' })).cookies;
  const hostCookie = storedCookies.find(item => item.name === 'imported_host');
  assert.equal(hostCookie.domain, '127.0.0.1'); assert.equal(hostCookie.httpOnly, true); assert.equal(hostCookie.session, false);
  assert.equal(storedCookies.find(item => item.name === 'imported_domain').session, true);
  assert.deepEqual(storedCookies.find(item => item.name === 'imported_partition').partitionKey, { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false });
  const importedSession = await request('POST', `/v1/pages/${sibling.id}/evaluate`, { expression: 'fetch("/api/whoami").then(r=>r.json())' });
  assert.ok(importedSession.result.value.cookie.includes('imported_host=synthetic-import'));
  const otherCookies = (await request('POST', `/v1/pages/${isolated.id}/cdp`, { method: 'Network.getAllCookies' })).cookies;
  assert.equal(otherCookies.some(item => item.name.startsWith('imported_')), false);
  check('Cookie import preserves host/domain scope, HttpOnly, session, expiry and partitionKey; profiles stay isolated');
  await request('POST', `/v1/pages/${page.id}/evaluate`, { expression: 'fetch("/redirect").then(r=>r.json())' });
  await waitUntil(async () => (await request('GET', `/v1/records?pageId=${page.id}&kind=network`)).some(record => record.state === 'redirected' && record.status === 302), 'redirect recorded');
  await request('POST', `/v1/pages/${page.id}/evaluate`, { expression: 'fetch("/large").then(r=>r.text()).then(t=>t.length)' });
  await waitUntil(async () => (await request('GET', `/v1/records?pageId=${page.id}&kind=network`)).some(record => record.url.endsWith('/large') && (record.body?.truncated || record.bodyUnavailable)), 'bounded response');
  check('redirect history and explicit oversized-response truncation');
  const resources = await request('GET', `/v1/pages/${page.id}/resources`); assert.ok(resources.frameTree.resources.some(resource => resource.url.endsWith('/app.js')));
  const source = await request('POST', `/v1/pages/${page.id}/cdp`, { method: 'Page.getResourceContent', params: { frameId: resources.frameTree.frame.id, url: fixtureUrl + '/app.js' } });
  assert.ok(source.content.includes('fixtureLoaded')); check('resource discovery and loaded JavaScript source retrieval');
  const screenshot = await request('GET', `/v1/pages/${page.id}/screenshot`);
  await fs.writeFile(path.join(directory, 'page.png'), Buffer.from(screenshot.data, 'base64'));
  const shellPage = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('/ui/index.html'));
  assert.ok(shellPage); await shellPage.waitForFunction(() => document.querySelector('#profiles').children.length === 2);
  const originalSiteColor = await browserPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  for (const [theme, background] of [['cloud', 'rgb(249, 250, 252)'], ['graphite', 'rgb(21, 24, 32)'], ['pine', 'rgb(234, 240, 233)']]) {
    await shellPage.locator(`[data-theme-choice="${theme}"]`).click();
    assert.equal(await shellPage.locator(`[data-theme-choice="${theme}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(await shellPage.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).backgroundColor), background);
    await request('GET', '/v1/window/screenshot');
    await new Promise(resolve => setTimeout(resolve, 100));
    const image = await request('GET', '/v1/window/screenshot');
    await fs.writeFile(path.join(directory, `theme-${theme}.png`), Buffer.from(image.data, 'base64'));
  }
  await shellPage.reload();
  await shellPage.waitForFunction(() => document.querySelector('#profiles').children.length === 2);
  assert.equal(await shellPage.evaluate(() => document.documentElement.dataset.theme), 'pine');
  assert.equal(await browserPage.evaluate(() => getComputedStyle(document.body).backgroundColor), originalSiteColor);
  assert.equal((await request('GET', `/v1/pages/${page.id}`)).targetId, page.targetId);
  check('three themes switch instantly and persist across shell reload; website styling and page target stay unchanged');
  const workspaceImage = await request('GET', '/v1/window/screenshot');
  await fs.writeFile(path.join(directory, 'workspace.png'), Buffer.from(workspaceImage.data, 'base64'));
  // Dialogs hide only the native view; pages remain alive and continue recording.
  await shellPage.getByRole('button', { name: '查看记录', exact: true }).click();
  await shellPage.locator('#records-dialog').waitFor({ state: 'visible' });
  const recordsImage = await request('GET', '/v1/window/screenshot');
  await fs.writeFile(path.join(directory, 'records.png'), Buffer.from(recordsImage.data, 'base64'));
  await shellPage.locator('#close-records').click();
  await shellPage.getByRole('button', { name: '导入 Cookie', exact: false }).click();
  await shellPage.locator('#cookie-profile').selectOption(profileId);
  await shellPage.locator('#cookie-reload').uncheck();
  const uiCookie = { domain: '127.0.0.1', name: 'imported_ui', value: 'synthetic-ui', hostOnly: true, path: '/', session: true, sameSite: null };
  await shellPage.locator('#cookie-input').fill(JSON.stringify([uiCookie]));
  await shellPage.locator('#run-cookie-import').click();
  await shellPage.waitForFunction(() => document.querySelector('#cookie-result').textContent.includes('成功 1'));
  assert.equal(await shellPage.locator('#cookie-input').inputValue(), '');
  const fileCookie = { ...uiCookie, name: 'imported_file', value: 'synthetic-file' };
  await shellPage.locator('#cookie-file').setInputFiles({ name: 'synthetic-cookies.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ cookies: [fileCookie] })) });
  await shellPage.waitForFunction(() => document.querySelector('#cookie-input').value.includes('imported_file'));
  await shellPage.locator('#run-cookie-import').click();
  await shellPage.waitForFunction(() => document.querySelector('#cookie-input').value === '' && document.querySelector('#cookie-result').textContent.includes('成功 1'));
  const importedViaUI = (await request('POST', `/v1/pages/${page.id}/cdp`, { method: 'Network.getAllCookies' })).cookies;
  assert.ok(importedViaUI.some(item => item.name === 'imported_ui')); assert.ok(importedViaUI.some(item => item.name === 'imported_file'));
  const cookieImage = await request('GET', '/v1/window/screenshot');
  await fs.writeFile(path.join(directory, 'cookies.png'), Buffer.from(cookieImage.data, 'base64'));
  await shellPage.locator('#close-cookies').click();
  check('Cookie dialog imports pasted arrays and selected JSON files into the chosen environment');
  check('workspace UI and capture viewer render, screenshot files saved');
  const cleanupProfile = await request('POST', '/v1/profiles', { name: '标签清理验收' });
  const cleanupTabs = [];
  for (let index = 0; index < 12; index++) cleanupTabs.push(await request('POST', '/v1/pages', { profileId: cleanupProfile.id }));
  const keptTab = cleanupTabs.at(-1);
  await shellPage.waitForFunction(() => document.querySelectorAll('#tabs .tab').length === 12);
  const cleanupBounds = await shellPage.locator('.tab-actions').boundingBox();
  const tabRowBounds = await shellPage.locator('.tabs-row').boundingBox();
  assert.ok(cleanupBounds.x >= tabRowBounds.x && cleanupBounds.x + cleanupBounds.width <= tabRowBounds.x + tabRowBounds.width);
  const cleanupImage = await request('GET', '/v1/window/screenshot');
  await fs.writeFile(path.join(directory, 'tab-actions.png'), Buffer.from(cleanupImage.data, 'base64'));
  await shellPage.locator('#close-other-tabs').click();
  await waitUntil(async () => (await request('GET', '/v1/pages')).filter(item => item.profileId === cleanupProfile.id).length === 1, 'close other tabs');
  await shellPage.waitForFunction(() => document.querySelector('#close-other-tabs').disabled && !document.querySelector('#close-all-tabs').disabled);
  assert.equal((await request('GET', '/v1/status')).activePageId, keptTab.id);
  assert.equal((await request('GET', `/v1/pages/${page.id}`)).targetId, page.targetId);
  await request('POST', '/v1/pages', { profileId: cleanupProfile.id });
  await shellPage.waitForFunction(() => !document.querySelector('#close-other-tabs').disabled);
  await shellPage.locator('#close-all-tabs').click();
  await waitUntil(async () => !(await request('GET', '/v1/pages')).some(item => item.profileId === cleanupProfile.id), 'close all tabs in environment');
  await shellPage.waitForFunction(() => document.querySelector('#close-all-tabs').disabled && document.querySelector('#close-other-tabs').disabled);
  assert.equal((await request('GET', '/v1/status')).activePageId, null);
  assert.equal(await shellPage.locator('#profile-name').textContent(), cleanupProfile.name);
  assert.equal(await shellPage.locator('#address').inputValue(), '');
  assert.equal(await shellPage.locator('#empty-state').isVisible(), true);
  const persistedCleanup = JSON.parse(await fs.readFile(path.join(directory, 'workspace.json'), 'utf8'));
  assert.ok(!persistedCleanup.tabs.some(item => item.profileId === cleanupProfile.id));
  assert.equal((await request('GET', `/v1/pages/${isolated.id}`)).targetId, isolated.targetId);
  await shellPage.locator('#empty-new-tab').click();
  await waitUntil(async () => (await request('GET', '/v1/pages')).some(item => item.profileId === cleanupProfile.id), 'new tab after cleanup');
  await shellPage.waitForFunction(() => document.querySelectorAll('#tabs .tab').length === 1 && !document.querySelector('#close-all-tabs').disabled);
  await request('POST', `/v1/pages/${page.id}/select`);
  check('fixed tab cleanup buttons survive overflow; keep current, clear environment, persist removal and create again without touching other environments');
  await browser.close(); browser = null;
  await request('POST', `/v1/pages/${page.id}/evaluate`, { expression: 'fetch("/api/agents?disconnected=1").then(r=>r.json())' });
  await waitUntil(async () => (await request('GET', `/v1/records?pageId=${page.id}&kind=network`)).some(record => record.url.includes('disconnected=1') && record.state === 'finished'), 'record while detached');
  browser = await chromium.connectOverCDP(connection.cdpEndpoint); assert.ok((await request('GET', '/v1/pages')).some(item => item.targetId === page.targetId));
  await browser.close(); browser = null;
  check('external CDP detach/reconnect preserves page identity and continuous recording');
  const beforeHide = await request('GET', '/v1/status');
  await request('POST', '/v1/window', { action: 'show' });
  assert.equal((await request('GET', '/v1/status')).visible, true);
  await request('POST', '/v1/window', { action: 'hide' });
  const hiddenState = await request('GET', '/v1/status');
  assert.equal(hiddenState.visible, false); assert.equal(hiddenState.trayAvailable, true);
  assert.equal(hiddenState.pages[0].targetId, beforeHide.pages[0].targetId);
  check('native tray remains available when hidden; show/hide preserves the existing page');
  const firstRun = (await request('GET', '/v1/status')).capture.runId;
  await stop(); await launch();
  status = await request('GET', '/v1/status'); assert.ok(status.pages.some(item => item.id === page.id));
  browser = await chromium.connectOverCDP(connection.cdpEndpoint);
  const restoredShell = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('/ui/index.html'));
  assert.equal(await restoredShell.evaluate(() => document.documentElement.dataset.theme), 'pine');
  await browser.close(); browser = null;
  await waitUntil(async () => {
    const result = await request('POST', `/v1/pages/${page.id}/evaluate`, { expression: 'fetch("/api/whoami").then(r=>r.json())' });
    return result.result?.value?.cookie?.includes('synthetic-session');
  }, 'persisted login after restart');
  const persistedImportedCookies = (await request('POST', `/v1/pages/${page.id}/cdp`, { method: 'Network.getAllCookies' })).cookies;
  assert.ok(persistedImportedCookies.some(item => item.name === 'imported_host'));
  assert.ok(persistedImportedCookies.some(item => item.name === 'imported_partition' && item.partitionKey.topLevelSite === 'https://example.test'));
  check('imported persistent and partitioned cookies survive restart');
  const archive = await request('GET', `/v1/captures/${firstRun}/records?pageId=${page.id}&kind=network`);
  assert.ok(archive.some(record => record.url.includes('/api/agents') && record.body?.text));
  check('restart restores page IDs and persistent login; previous capture archive remains readable');
  await stop(); child = null;
  await fs.writeFile(path.join(directory, 'summary.json'), JSON.stringify({ ok: true, checks, artifacts: directory }, null, 2));
  await fs.writeFile(path.join(directory, 'electron.log'), output.join(''));
  console.log(`Integration passed: ${checks.length} checks. Artifacts: ${directory}`);
}
main().catch(async error => {
  console.error(error.stack); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'failure.json'), JSON.stringify({ error: error.stack, checks }, null, 2)); process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) { try { await stop(); } catch { child.kill(); } }
  fixture?.close();
});
