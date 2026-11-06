const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

class CdpConnection extends EventEmitter {
  constructor(socket) {
    super(); this.socket = socket; this.sequence = 0; this.pending = new Map();
    socket.on('message', data => {
      let message; try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.id) {
        const task = this.pending.get(message.id);
        if (!task) return;
        clearTimeout(task.timer); this.pending.delete(message.id);
        if (message.error) task.reject(new Error(message.error.message));
        else task.resolve(message.result ?? {});
      } else if (message.method) this.emit('event', message.method, message.params ?? {}, message.sessionId);
    });
    socket.on('error', error => this.emit('transport-error', error));
    socket.on('close', () => {
      for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('CDP connection closed')); }
      this.pending.clear(); this.emit('disconnected');
    });
  }
  static async connect(url, timeout = 10000) {
    const socket = new WebSocket(url, { maxPayload: 32 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('CDP connection timed out')); }, timeout);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
    return new CdpConnection(socket);
  }
  send(method, params = {}, sessionId, timeout = 12000) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP is disconnected'));
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }), error => {
        if (!error) return;
        clearTimeout(timer); this.pending.delete(requestId); reject(error);
      });
    });
  }
  close() { this.socket.close(); }
}
module.exports = { CdpConnection };
