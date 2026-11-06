const { prepareCookies } = require('./cookie-format.cjs');

class CookieImporter {
  constructor({ getConnection, flushCookies, validateProfile }) {
    Object.assign(this, { getConnection, flushCookies, validateProfile }); this.queues = new Map();
  }
  async import(profileId, input) {
    this.validateProfile(profileId);
    const prepared = prepareCookies(input);
    const previous = this.queues.get(profileId) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(() => this.apply(profileId, prepared));
    this.queues.set(profileId, result);
    try { return await result; } finally { if (this.queues.get(profileId) === result) this.queues.delete(profileId); }
  }
  async apply(profileId, prepared) {
    const ready = prepared.filter(item => item.status === 'ready');
    const connection = ready.length ? await this.getConnection(profileId) : null;
    const items = []; let imported = 0; let partitioned = 0;
    for (const item of prepared) {
      const { params, ...summary } = item;
      if (item.status !== 'ready') { items.push(summary); continue; }
      try {
        const result = await connection.send('Network.setCookie', params);
        if (result.success === false) throw new Error('Browser rejected cookie');
        imported++; if (params.partitionKey) partitioned++;
        items.push({ ...summary, status: 'imported', partitioned: Boolean(params.partitionKey) });
      } catch {
        items.push({ ...summary, status: 'failed', reason: params.partitionKey ?
          '浏览器未接受此分区 Cookie；未降级为普通 Cookie，请检查域名和分区属性' : '浏览器未接受此 Cookie，请检查域名、大小和属性限制' });
      }
    }
    let persistenceError = null;
    if (imported) {
      try { await this.flushCookies(profileId); } catch { persistenceError = 'Cookie 已写入当前会话，但保存到磁盘失败；重启后可能丢失'; }
    }
    return { profileId, total: items.length, imported, partitioned, skipped: items.filter(item => item.status === 'expired').length,
      failed: items.filter(item => ['invalid', 'failed'].includes(item.status)).length, persistenceError,
      domains: [...new Set(items.filter(item => item.status === 'imported').map(item => item.domain))], items };
  }
}
module.exports = { CookieImporter };
