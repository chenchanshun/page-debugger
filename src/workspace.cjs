const fs = require('node:fs/promises');
const path = require('node:path');
const { id, atomicJson, httpError } = require('./utils.cjs');

class Workspace {
  constructor(directory) { this.directory = directory; this.filename = path.join(directory, 'workspace.json'); this.queue = Promise.resolve(); }
  async load() {
    try {
      this.state = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (this.state.version !== 1 || !Array.isArray(this.state.profiles) || !Array.isArray(this.state.tabs)) throw new Error('Invalid workspace');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`无法读取工作区，原文件已保留：${error.message}`);
      this.state = { version: 1, profiles: [{ id: id('profile'), name: '默认环境', color: '#16a085' }], tabs: [], activePageId: null };
    }
    return this.state;
  }
  save() {
    const snapshot = structuredClone(this.state);
    const saving = this.queue.then(() => atomicJson(this.filename, snapshot));
    this.queue = saving.catch(() => {}); return saving;
  }
  async createProfile(input) {
    const name = String(input?.name ?? '').trim();
    if (!name || name.length > 60) throw httpError(400, '环境名称需要 1–60 个字符');
    const profile = { id: id('profile'), name, color: /^#[a-f\d]{6}$/i.test(input.color ?? '') ? input.color : '#5271ff' };
    this.state.profiles.push(profile); await this.save(); return profile;
  }
  getProfile(profileId) {
    const profile = this.state.profiles.find(item => item.id === profileId);
    if (!profile) throw httpError(404, '环境不存在'); return profile;
  }
  async setProfileClosed(profileId, closed) {
    const profile = this.getProfile(profileId);
    profile.closed = Boolean(closed); await this.save(); return profile;
  }
}
module.exports = { Workspace };
