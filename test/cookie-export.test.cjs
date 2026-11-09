const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CookieExporter, formatExportCookie, serializeCookies } = require('../src/cookie-exporter.cjs');
const { normalizeCookie } = require('../src/cookie-format.cjs');

function browserCookie(overrides = {}) {
  return { domain: '.example.test', name: 'session_id', value: 'synthetic$encoded%2Fvalue', path: '/',
    httpOnly: true, secure: true, session: true, expires: -1, sameSite: 'None', ...overrides };
}
test('导出为指定扩展数组格式，会话 Cookie 不带 expirationDate', () => {
  const exported = formatExportCookie(browserCookie());
  assert.deepEqual(exported, { domain: '.example.test', hostOnly: false, httpOnly: true, name: 'session_id',
    path: '/', sameSite: 'no_restriction', secure: true, session: true, storeId: null, value: 'synthetic$encoded%2Fvalue' });
  assert.deepEqual(JSON.parse(serializeCookies([exported])), [exported]);
  assert.equal(serializeCookies([exported]).startsWith('[\n    {\n'), true);
  assert.equal(serializeCookies([]), '[]\n');
});
test('导出保留浮点过期秒、hostOnly 和 SameSite，并能无损重新导入', () => {
  const expires = Date.now() / 1000 + 86400.123456;
  for (const [sameSite, expected] of [['Strict', 'strict'], ['Lax', 'lax'], [undefined, null], ['unspecified', null]]) {
    const exported = formatExportCookie(browserCookie({ domain: 'console.example.test', session: false, expires, sameSite }));
    assert.equal(exported.expirationDate, expires); assert.equal(exported.hostOnly, true); assert.equal(exported.sameSite, expected);
    const imported = normalizeCookie(exported, 0);
    assert.equal(imported.status, 'ready'); assert.equal(imported.params.value, exported.value);
    assert.equal(imported.params.expires, expires); assert.equal('domain' in imported.params, false);
  }
  const partitionKey = { topLevelSite: 'https://example.test', hasCrossSiteAncestor: true };
  const exported = formatExportCookie(browserCookie({ partitionKey }));
  assert.deepEqual(normalizeCookie(exported, 0).params.partitionKey, partitionKey);
  assert.notEqual(exported.partitionKey, partitionKey);
  assert.equal(formatExportCookie(browserCookie({ partitionKeyOpaque: true })).partitionKeyOpaque, true);
});
test('导出只读取指定环境，网站范围遵守域名边界且包含所有路径', async () => {
  let requestedProfile;
  const cookies = [browserCookie(), browserCookie({ domain: 'console.example.test', path: '/account', name: 'host' }),
    browserCookie({ domain: 'example.test', name: 'parent_host' }), browserCookie({ domain: '.otherexample.test' }),
    browserCookie({ domain: 'other.example.test' })];
  const exporter = new CookieExporter({ validateProfile: id => assert.equal(id, 'target'),
    getConnection: async id => { requestedProfile = id; return { send: async method => { assert.equal(method, 'Network.getAllCookies'); return { cookies }; } }; } });
  const result = await exporter.export('target', { url: 'https://CONSOLE.example.test/path' });
  assert.equal(requestedProfile, 'target'); assert.deepEqual(result.map(item => item.name), ['session_id', 'host']);
  assert.equal((await exporter.export('target')).length, 5);
  assert.equal((await exporter.export('target', { url: 'https://empty.invalid' })).length, 0);
  for (const url of ['file:///secret', 'https://user:password@example.test', 'invalid']) await assert.rejects(exporter.export('target', { url }), /导出范围/);
});
test('导出失败信息不包含底层异常中的 Cookie 内容', async () => {
  const exporter = new CookieExporter({ validateProfile: () => {}, getConnection: async () => ({ send: async () => { throw new Error('synthetic-sensitive-value'); } }) });
  await assert.rejects(exporter.export('target'), error => error.message === '读取 Cookie 失败，请稍后重试');
  const closedExporter = new CookieExporter({ validateProfile: () => ({ closed: true }), getConnection: () => assert.fail('不得重新打开已关闭环境') });
  await assert.rejects(closedExporter.export('target'), /请先打开/);
});
