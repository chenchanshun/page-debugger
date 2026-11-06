const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareCookies, normalizeCookie } = require('../src/cookie-format.cjs');
const { CookieImporter } = require('../src/cookie-importer.cjs');

const now = 1800000000;
const cookie = (overrides = {}) => ({ domain: '.example.test', name: 'test_cookie', value: 'synthetic$encoded%2Fvalue', path: '/',
  secure: true, httpOnly: true, hostOnly: false, expirationDate: now + 86400.25, session: false, storeId: null, sameSite: 'strict', ...overrides });
test('兼容扩展导出的数组、包装对象、BOM 与浮点秒，Cookie 值保持原样', () => {
  for (const input of [[cookie()], { cookies: [cookie()] }, '\uFEFF' + JSON.stringify([cookie()])]) {
    const [item] = prepareCookies(input, now);
    assert.equal(item.status, 'ready'); assert.equal(item.params.value, cookie().value);
    assert.equal(item.params.expires, now + 86400.25); assert.equal(item.params.sameSite, 'Strict');
    assert.equal(item.params.httpOnly, true); assert.equal(item.params.domain, '.example.test');
    assert.equal('storeId' in item.params, false);
  }
  assert.throws(() => prepareCookies('not json'), /JSON 格式/);
  assert.throws(() => prepareCookies([]), /非空/);
});
test('hostOnly、SameSite null 和会话 Cookie 不被转换为其他语义', () => {
  const host = normalizeCookie(cookie({ hostOnly: true, sameSite: null }), 0, now);
  assert.equal('domain' in host.params, false); assert.equal('sameSite' in host.params, false);
  const session = normalizeCookie(cookie({ session: true, expirationDate: now - 10, sameSite: 'no_restriction' }), 0, now);
  assert.equal('expires' in session.params, false); assert.equal(session.params.sameSite, 'None');
  assert.equal(normalizeCookie(cookie({ expirationDate: now - 10 }), 0, now).status, 'expired');
});
test('保留 partitionKey 与 hasCrossSiteAncestor，无法支持的分区不降级', () => {
  const result = normalizeCookie(cookie({ sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false } }), 0, now);
  assert.deepEqual(result.params.partitionKey, { topLevelSite: 'https://example.test', hasCrossSiteAncestor: false });
  assert.equal(normalizeCookie(cookie({ partitionKey: { topLevelSite: 'file:///secret' } }), 0, now).status, 'invalid');
  assert.equal(normalizeCookie(cookie({ secure: false, partitionKey: 'https://example.test' }), 0, now).status, 'invalid');
  assert.equal(normalizeCookie(cookie({ partitionKeyOpaque: true }), 0, now).status, 'invalid');
});
test('非法字段和 Cookie 前缀的失败不会抛出带 Cookie 正文的原始异常', () => {
  for (const input of [null, cookie({ name: 123 }), cookie({ name: 'bad name' }), cookie({ secure: 'true' }), cookie({ domain: 'example.test/path' }),
    cookie({ sameSite: 'constructor' }), cookie({ secure: false, sameSite: 'none' }), cookie({ name: '__Host-test', hostOnly: false })]) {
    assert.equal(normalizeCookie(input, 0, now).status, 'invalid');
  }
});
test('导入逐项报告结果、跳过过期条目、刷新持久化，结果不包含 value', async () => {
  const calls = []; let flushed = false;
  const importer = new CookieImporter({ validateProfile: () => {}, flushCookies: async () => { flushed = true; },
    getConnection: async () => ({ send: async (method, params) => { calls.push({ method, params }); if (params.name === 'rejected') throw new Error('secret value must not escape'); return { success: true }; } }) });
  const result = await importer.import('profile_test', [cookie({ expirationDate: Date.now() / 1000 + 86400 }),
    cookie({ expirationDate: 1 }), cookie({ name: 'rejected', session: true, partitionKey: 'https://example.test' }), cookie({ name: 'invalid name' })]);
  assert.equal(result.imported, 1); assert.equal(result.skipped, 1); assert.equal(result.failed, 2); assert.equal(calls.length, 2);
  assert.equal(flushed, true); assert.equal(JSON.stringify(result).includes(cookie().value), false);
  assert.equal(JSON.stringify(result).includes('secret value'), false); assert.equal(calls[1].params.partitionKey.topLevelSite, 'https://example.test');
});
