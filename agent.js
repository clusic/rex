const fs = require('fs');
const path = require('path');
const utils = require('@clusic/utils');
const { EventEmitter } = require('events');
const PluginLoader = require('./lib/plugin');
const [$cluster, LifeCycles, FeedCycles] = [
  Symbol('AgentService#var.cluster'),
  Symbol('AgentService#LifeCycles'),
  Symbol('AgentService#FeedCycles')
];

module.exports = class AgentService extends EventEmitter {
  constructor(cluster, options = {}) {
    super();
    this[$cluster] = cluster;
    this.cwd = options.cwd || process.cwd();
    this.env = options.env || process.env.NODE_ENV || 'development';
    this.type = options.type;
    this.name = options.name;
    this.Logger = console;
    this.Plugin = new PluginLoader(this, this.cwd, this.env, this.type, this.name);
    this[LifeCycles] = {};
    this[FeedCycles] = {}
  }
  
  createError(message, code) {
    const err = new Error(message);
    if (code >= 500 && code < 600) {
      err.status = code;
    }
    return err;
  }
  
  kill() {
    return this[$cluster].kill();
  }
  
  send(...args) {
    return this[$cluster].send(...args);
  }
  
  feed(name, asyncFunction) {
    if (typeof asyncFunction !== 'function') return this;
    if (this[FeedCycles][name]) throw new Error(`${name} has been set on FeedCycles`);
    this[FeedCycles][name] = asyncFunction;
    return this;
  }
  
  bind(name, asyncFunction) {
    if (typeof asyncFunction !== 'function') return this;
    if (!this[LifeCycles][name]) this[LifeCycles][name] = [];
    this[LifeCycles][name].push(asyncFunction);
    return this;
  }
  
  async trigger(name, ...args) {
    if (this[LifeCycles][name]) {
      for (let i = 0; i < this[LifeCycles][name].length; i++) {
        await this[LifeCycles][name][i](...args);
      }
    }
  }
  
  async processCreate() {
    const plugins = this.Plugin.analysis();
    for (let i = 0; i < plugins.length; i++) {
      if (typeof plugins[i].exports === 'function') {
        await plugins[i].exports(this, this.Plugin.maps[plugins[i].name]);
      }
    }
    const appFile = path.resolve(this.cwd, this.name + '.bootstrap.js');
    if (fs.existsSync(appFile)) {
      const appExports = utils.loadFile(appFile);
      if (typeof appExports === 'function') {
        await appExports(this);
      }
    }
  }
  
  async processDestroy() {
    await this.trigger('stop');
  }
  
  processMessage(msg, socket) {
    if (msg.action === 'cluster:ready') {
      this.trigger('ready', socket).catch(e => this.Logger.error('[agent:cluster:ready] Error:', e));
    } else if (msg.action === '#ipc_feed#') {
      const { event, data, id } = msg.body;
      const from = msg.from;
      if (!this[FeedCycles][event]) return this.send(from, '#ipc_feed#', { status: 404, id });
      const result = this[FeedCycles][event](data);
      if (!result) return this.send(from, '#ipc_feed#', { status: 200, id });
      if (result.then) {
        result.then(data =>  {
          if (data instanceof Error) {
            this.send(from, '#ipc_feed#', { status: data.status || 500, id, data: data.message });
          } else {
            this.send(from, '#ipc_feed#', { status: 200, id, data });
          }
        }).catch(e => this.send(from, '#ipc_feed#', { status: 600, id, data: e.message }))
      } else {
        if (result instanceof Error) {
          this.send(from, '#ipc_feed#', { status: result.status || 500, id, data: result.message });
        } else {
          this.send(from, '#ipc_feed#', { status: 200, id, data: result });
        }
      }
    } else {
      this.emit(msg.action, msg.body, msg.from, socket);
    }
  }
};