const fs = require('fs');
const path = require('path');
const is = require('is-type-of');
const utils = require('@clusic/utils');
const intersect = require('@evio/intersect');

class SinglePlugin {
  constructor(app, cwd, name, dependencies, pluginEnvExports) {
    this.app = app;
    this.cwd = cwd;
    this.name = name;
    this.dependencies = dependencies;
    this.config = pluginEnvExports[this.name] || {};
  }
  
  dependency(dependency) {
    if (this.dependencies.indexOf(dependency) === -1) throw new Error(`${dependency} is not one of ${JSON.stringify(this.dependencies)}`);
    return this.app.Plugin.maps[dependency];
  }
}

module.exports = class Plugin {
  constructor(app, cwd, env, type, name) {
    this.app = app;
    this.cwd = cwd;
    this.env = env;
    this.type = type;
    this.name = name;
    this.framework = require('../package.json').name;
    this.maps = {};
  }
  
  /**
   * plugin config
   * @param enable {boolean} <default:false> 是否启动插件
   * @param env {undefined|string|array<string>} <default: undefined> 运行环境
   * @param agent {undefined|string|array<string>} <default: undefined> 运行的agent进程
   * @param framework {undefined|string} <default: undefined> 支持的framework架构
   * @param dependencies {undefined|string|array<string>} <default: undefined> 依赖插件列表
   * @returns {Promise<void>}
   */
  analysis() {
    const pluginTrees = {};
    const pluginFile = path.resolve(this.cwd, 'config', 'plugin.json');
    const pluginEnvFile = path.resolve(this.cwd, 'config', `plugin.${this.env}.json`);
    let pluginExports = fs.existsSync(pluginFile) ? utils.loadFile(pluginFile) : {};
    let pluginEnvExports = fs.existsSync(pluginEnvFile) ? utils.loadFile(pluginEnvFile) : {};
    for (const plugin in pluginExports) {
      const config = pluginExports[plugin];
      const pluginNodeModuleExports = utils.loadFile(plugin + '/package.json');
      
      // 参数兼容
      config.enable = !!config.enable;
      if (!config.env) config.env = [];
      if (!is.array(config.env)) config.env = [config.env];
      if (!config.env.length) config.env = [this.env];
      if (!config.agent) config.agent = [];
      if (!is.array(config.agent)) config.agent = [config.agent];
      if (!config.framework) {
        if (pluginNodeModuleExports.plugin && pluginNodeModuleExports.plugin.framework) {
          config.framework = pluginNodeModuleExports.plugin.framework;
        } else {
          config.framework = this.framework;
        }
      }
      if (!config.dependencies) config.dependencies = [];
      if (!is.array(config.dependencies)) config.dependencies = [config.dependencies];
      if (pluginNodeModuleExports.plugin && pluginNodeModuleExports.plugin.dependencies) {
        if (!is.array(pluginNodeModuleExports.plugin.dependencies)) pluginNodeModuleExports.plugin.dependencies = [pluginNodeModuleExports.plugin.dependencies];
        for (let i = 0; i < pluginNodeModuleExports.plugin.dependencies.length; i++) {
          if (config.dependencies.indexOf(pluginNodeModuleExports.plugin.dependencies[i]) === -1) {
            config.dependencies.push(pluginNodeModuleExports.plugin.dependencies[i]);
          }
        }
      }
      
      // 条件判断
      if (!config.enable) continue;
      if (config.env.indexOf(this.env) === -1) continue;
      if (config.framework !== this.framework) continue;
      if (this.type === 'agent') {
        if (!config.agent.length) continue;
        if (config.agent.indexOf(this.name) === -1) continue;
      }
      
      let dir, filePath;
      if (path.isAbsolute(plugin)) { dir = plugin; }
      else if (plugin.charAt(0) === '.') { dir = path.resolve(this.cwd, 'config', plugin); }
      else { dir = path.resolve(this.cwd, 'node_modules', plugin); }
      if (this.type === 'agent') { filePath = path.resolve(dir, 'agent.js'); }
      else { filePath = path.resolve(dir, 'app.js'); }
      const moduleExports = fs.existsSync(filePath) ? utils.loadFile(filePath) : null;
      this.maps[plugin] = new SinglePlugin(this.app, dir, plugin, config.dependencies, pluginEnvExports);
      pluginTrees[plugin] = {
        dir,
        dependencies: config.dependencies,
        exports: moduleExports
      }
    }
    return this.sortPluginDependencies(pluginTrees);
  }
  
  sortPluginDependencies(tree) {
    const result = [];
    const keys = Object.keys(tree);
    let j = keys.length;
    while (j--) {
      const obj = tree[keys[j]];
      if (obj.dependencies.length) {
        const res = intersect(obj.dependencies, keys);
        if (res.removes.length) {
          throw new Error(`插件[${keys[j]}]依赖模块不存在：${res.removes.join(',')}`);
        }
      }
      Object.defineProperty(obj, 'deep', {
        get() {
          if (!obj.dependencies.length) return 0;
          return Math.max(...obj.dependencies.map(d => tree[d] ? tree[d].deep : 0)) + 1;
        }
      });
    }
  
    for (const i in tree) {
      tree[i].name = i;
      result.push(tree[i]);
    }
  
    return result.sort((a, b) => a.deep - b.deep);
  }
};