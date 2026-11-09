const { httpError } = require('./utils.cjs');
const sameSites = new Map([['Strict', 'strict'], ['Lax', 'lax'], ['None', 'no_restriction']]);

function exportHostname(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return parsed.hostname.toLowerCase();
  } catch { throw httpError(400, '导出范围需要有效的 HTTP 或 HTTPS 网址'); }
}
function formatExportCookie(cookie) {
  const session = cookie.session ?? !(Number.isFinite(cookie.expires) && cookie.expires >= 0);
  const result = { domain: cookie.domain,
    ...(!session && Number.isFinite(cookie.expires) && cookie.expires >= 0 ? { expirationDate: cookie.expires } : {}),
    hostOnly: cookie.hostOnly ?? !cookie.domain.startsWith('.'), httpOnly: Boolean(cookie.httpOnly), name: cookie.name,
    path: cookie.path, sameSite: sameSites.get(cookie.sameSite) ?? null,
    secure: Boolean(cookie.secure), session, storeId: null, value: cookie.value };
  if (cookie.partitionKey != null) result.partitionKey = structuredClone(cookie.partitionKey);
  if (cookie.partitionKeyOpaque) result.partitionKeyOpaque = true;
  return result;
}
function serializeCookies(cookies) { return JSON.stringify(cookies, null, 4) + '\n'; }

class CookieExporter {
  constructor({ validateProfile, getConnection }) { Object.assign(this, { validateProfile, getConnection }); }
  async export(profileId, { url } = {}) {
    const profile = this.validateProfile(profileId);
    if (profile?.closed) throw httpError(409, '请先打开此环境再导出 Cookie');
    const hostname = exportHostname(url);
    const connection = await this.getConnection(profileId);
    let cookies;
    try { ({ cookies } = await connection.send('Network.getAllCookies')); }
    catch { throw httpError(503, '读取 Cookie 失败，请稍后重试'); }
    return cookies.map(formatExportCookie).filter(cookie => {
      if (!hostname) return true;
      const domain = cookie.domain.replace(/^\./, '').toLowerCase();
      return hostname === domain || (!cookie.hostOnly && hostname.endsWith(`.${domain}`));
    });
  }
}
module.exports = { CookieExporter, exportHostname, formatExportCookie, serializeCookies };
