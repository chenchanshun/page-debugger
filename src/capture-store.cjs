const fs = require('node:fs/promises');
const path = require('node:path');
const { id, atomicJson } = require('./utils.cjs');

class CaptureStore {
  constructor(directory, options = {}) {
    this.runId = id('run'); this.root = path.join(directory, 'captures'); this.directory = path.join(this.root, this.runId);
    this.maxRecords = options.maxRecords ?? 2000; this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.records = new Map(); this.sizes = new Map(); this.pending = new Map(); this.bytes = 0; this.evicted = 0;
    this.lastError = null; this.writing = Promise.resolve(); this.timer = null;
  }
  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
    await atomicJson(path.join(this.directory, 'manifest.json'), { runId: this.runId, startedAt: new Date().toISOString(), version: 1 });
  }
  upsert(kind, pageId, value) {
    const record = { ...value, kind, pageId, runId: this.runId };
    const size = Buffer.byteLength(JSON.stringify(record));
    this.bytes -= this.sizes.get(record.id) ?? 0;
    this.records.set(record.id, record); this.sizes.set(record.id, size); this.bytes += size;
    this.pending.set(record.id, record);
    while (this.records.size > this.maxRecords || this.bytes > this.maxBytes) {
      const oldest = this.records.keys().next().value;
      this.records.delete(oldest); this.bytes -= this.sizes.get(oldest); this.sizes.delete(oldest);
      this.pending.set(oldest, null); this.evicted++;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 350);
      this.timer.unref();
    }
    return record;
  }
  get(recordId) { return this.records.get(recordId); }
  list({ pageId, kind, search = '', after = '', limit = 100, includeBodies = false } = {}) {
    const text = String(search).toLowerCase();
    return [...this.records.values()].filter(record => (!pageId || record.pageId === pageId) && (!kind || record.kind === kind) &&
      (!after || record.startedAt > after) && (!text || `${record.url ?? ''} ${record.method ?? ''} ${record.message ?? ''}`.toLowerCase().includes(text)))
      .slice(-Math.max(1, Math.min(Number(limit) || 100, 2000))).reverse().map(record => {
        if (includeBodies) return record;
        const { body, postData, ...summary } = record;
        return { ...summary, ...(body ? { body: { available: true, truncated: body.truncated, originalBytes: body.originalBytes, base64Encoded: body.base64Encoded } } : {}),
          ...(postData ? { hasPostData: true } : {}) };
      });
  }
  summary() { return { runId: this.runId, records: this.records.size, bytes: this.bytes, evicted: this.evicted, persistenceError: this.lastError }; }
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    const changes = [...this.pending]; this.pending.clear();
    this.writing = this.writing.then(async () => {
      for (const [recordId, record] of changes) {
        const filename = path.join(this.directory, `${recordId}.json`);
        if (record) await atomicJson(filename, record);
        else await fs.rm(filename, { force: true });
      }
      this.lastError = null;
    }).catch(error => { this.lastError = error.message; });
    await this.writing;
  }
  async archives() {
    const dirs = await fs.readdir(this.root, { withFileTypes: true });
    const results = await Promise.all(dirs.filter(dir => dir.isDirectory() && /^run_[\w-]+$/.test(dir.name)).map(async dir => {
      try { return JSON.parse(await fs.readFile(path.join(this.root, dir.name, 'manifest.json'), 'utf8')); } catch { return null; }
    }));
    return results.filter(Boolean).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async archiveRecords(runId, options) {
    if (!/^run_[\w-]+$/.test(runId)) throw new Error('Invalid run ID');
    if (runId === this.runId) return this.list({ ...options, includeBodies: true });
    const directory = path.join(this.root, runId);
    const names = (await fs.readdir(directory)).filter(name => /^(request|console|evaluation|event)_[\w-]+\.json$/.test(name));
    const records = [];
    for (const name of names) {
      try { const record = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
        if ((!options.pageId || options.pageId === record.pageId) && (!options.kind || options.kind === record.kind)) records.push(record);
      } catch { /* A partially removed archive is still readable. */ }
    }
    return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 2000);
  }
}
module.exports = { CaptureStore };
