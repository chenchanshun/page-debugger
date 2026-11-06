const { httpError } = require('./utils.cjs');

const MAX_COOKIE_JSON_BYTES = 4 * 1024 * 1024;
function readCookieArray(input) {
  let parsed = input;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input) > MAX_COOKIE_JSON_BYTES) throw httpError(413, 'Cookie JSON 不能超过 4 MiB');
    try { parsed = JSON.parse(input.replace(/^\uFEFF/, '')); } catch { throw httpError(400, 'Cookie JSON 格式不正确，请粘贴完整的数组或 {"cookies":[...]}'); }
  }
  const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;
  if (!Array.isArray(cookies) || !cookies.length) throw httpError(400, '需要非空 Cookie 数组，也支持 {"cookies":[...]}');
  if (cookies.length > 2000) throw httpError(400, '单次最多导入 2,000 条 Cookie');
  if (Buffer.byteLength(JSON.stringify(cookies)) > MAX_COOKIE_JSON_BYTES) throw httpError(413, 'Cookie JSON 不能超过 4 MiB');
  return cookies;
}
function normalizeCookie(cookie, index, nowSeconds = Date.now() / 1000) {
  const item = { index: index + 1, name: typeof cookie?.name === 'string' ? cookie.name.slice(0, 160) : '',
    domain: typeof cookie?.domain === 'string' ? cookie.domain.slice(0, 255) : '' };
  const invalid = reason => ({ ...item, status: 'invalid', reason });
  if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) return invalid('需要 Cookie 对象');
  if (typeof cookie.name !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookie.name)) return invalid('Cookie 名称为空或包含非法字符');
  if (typeof cookie.value !== 'string' || /[\x00-\x1f\x7f]/.test(cookie.value)) return invalid('Cookie value 需要为不含控制字符的字符串');
  const domainInput = typeof cookie.domain === 'string' ? cookie.domain : '';
  if (!domainInput || /[\s/@?#\\:]/.test(domainInput)) return invalid('缺少有效的 domain（只填写域名）');
  let hostname;
  try { hostname = new URL(`https://${domainInput.replace(/^\./, '')}`).hostname; } catch { return invalid('domain 格式无效'); }
  if (!hostname || hostname.startsWith('.') || hostname.endsWith('.')) return invalid('domain 格式无效');
  const cookiePath = cookie.path ?? '/';
  if (typeof cookiePath !== 'string' || !cookiePath.startsWith('/') || /[\x00-\x1f\x7f]/.test(cookiePath)) return invalid('path 必须以 / 开头且不包含控制字符');
  for (const key of ['hostOnly', 'httpOnly', 'secure', 'session']) {
    if (cookie[key] != null && typeof cookie[key] !== 'boolean') return invalid(`${key} 必须为布尔值`);
  }
  const hostOnly = cookie.hostOnly ?? !domainInput.startsWith('.');
  const secure = cookie.secure ?? false;
  const params = { name: cookie.name, value: cookie.value, url: `${secure ? 'https' : 'http'}://${hostname}${cookiePath}`,
    path: cookiePath, secure, httpOnly: cookie.httpOnly ?? false,
    ...(!hostOnly ? { domain: `.${hostname}` } : {}) };
  const sameSite = cookie.sameSite == null ? '' : String(cookie.sameSite).toLowerCase();
  const sameSites = { strict: 'Strict', lax: 'Lax', no_restriction: 'None', none: 'None', unspecified: '', '': '' };
  if (!Object.hasOwn(sameSites, sameSite)) return invalid('sameSite 需要为 strict、lax、no_restriction、none 或 null');
  if (sameSites[sameSite]) params.sameSite = sameSites[sameSite];
  if (params.sameSite === 'None' && !secure) return invalid('SameSite=None 的 Cookie 必须启用 secure');
  const expires = cookie.expirationDate ?? cookie.expires;
  if (cookie.session !== true && expires != null && expires !== -1) {
    if (typeof expires !== 'number' || !Number.isFinite(expires) || expires < 0) return invalid('过期时间必须为 Unix 秒时间戳');
    if (expires <= nowSeconds) return { ...item, status: 'expired', reason: 'Cookie 已过期，已跳过；不会用过期值删除现有 Cookie' };
    params.expires = expires;
  }
  if (cookie.partitionKeyOpaque) return invalid('无法导入 opaque partitionKey');
  if (cookie.partitionKey != null) {
    const key = cookie.partitionKey;
    const site = typeof key === 'string' ? key : key.topLevelSite;
    let topLevelSite;
    try { const url = new URL(site); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); topLevelSite = url.origin; }
    catch { return invalid('partitionKey.topLevelSite 必须为 HTTP 或 HTTPS 站点'); }
    if (!secure) return invalid('分区 Cookie 必须启用 secure');
    if (typeof key === 'object' && key.hasCrossSiteAncestor != null && typeof key.hasCrossSiteAncestor !== 'boolean') return invalid('hasCrossSiteAncestor 必须为布尔值');
    params.partitionKey = { topLevelSite, hasCrossSiteAncestor: typeof key === 'object' ? key.hasCrossSiteAncestor ?? false : false };
  }
  if (params.name.startsWith('__Secure-') && !secure) return invalid('__Secure- Cookie 必须启用 secure');
  if (params.name.startsWith('__Host-') && (!secure || !hostOnly || cookiePath !== '/')) return invalid('__Host- Cookie 必须启用 secure、hostOnly，且 path 为 /');
  return { ...item, domain: hostOnly ? hostname : `.${hostname}`, status: 'ready', params };
}
function prepareCookies(input, nowSeconds) { return readCookieArray(input).map((cookie, index) => normalizeCookie(cookie, index, nowSeconds)); }
module.exports = { MAX_COOKIE_JSON_BYTES, readCookieArray, normalizeCookie, prepareCookies };
