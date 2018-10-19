const KoaWorkerService = require('./lib/app');
const [$cluster, callbackId, callbacks] = [
  Symbol('WorkerService#var.cluster'),
  Symbol('WorkerService#callback.id'),
  Symbol('WorkerService#callback.pool')
];
module.exports = class WorkerService extends KoaWorkerService {
  constructor(cluster, options = {}) {
    options.cluster = true;
    super(options);
    this[$cluster] = cluster;
    this[callbackId] = 0;
    this[callbacks] = {};
    process.on('message', (name, socket) => {
      if (name === 'sticky:balance' && this.connection) {
        this.connection.emit('connection', socket);
        socket.resume();
      }
    });
  }
  
  kill() {
    this[$cluster].kill();
  }
  
  send(...args) {
    return this[$cluster].send(...args);
  }
  
  feed(agent, event, data, timeout) {
    return new Promise((resolve, reject) => {
      const id = this[callbackId]++;
      const timer = setTimeout(() => {
        if (!!this[callbacks][id]) {
          const err = new Error(`feed event[${event}] result from agent[${agent}] timeout`);
          err.status = 608;
          delete this[callbacks][id];
          reject(err);
        }
      }, timeout || 20 * 60 * 1000);
      this[callbacks][id] = (err, body) => {
        clearTimeout(timer);
        delete this[callbacks][id];
        if (err) return reject(err);
        resolve(body);
      };
      this.send(agent, '#ipc_feed#', { event, data, id });
    });
  }
  
  async processCreate() {
    await this.createService();
  }
  
  async processDestroy() {
    await this.trigger('beforeStop');
    await this.trigger('stop');
  }
  
  processMessage(msg, socket) {
    if (msg.action === 'cluster:ready') {
      this.trigger('ready', socket).catch(e => this.Logger.error('[worker:cluster:ready] Error:', e));
    } else if (msg.action === '#ipc_feed#') {
      const { status, id, data } = msg.body;
      if (this[callbacks][id]) {
        const result = [];
        switch (status) {
          case 200: result.push(null, data); break;
          default:
            const err = new Error(data);
            err.status = status;
            result.push(err);
        }
        this[callbacks][id](...result);
      }
    } else {
      this.emit(msg.action, msg.body, msg.from, socket);
    }
  }
};