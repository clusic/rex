const fs = require('fs');
const path = require('path');
const http = require('http');
const Koa = require('koa');
const Route = require('koa-router');
const utils = require('@clusic/utils');
const PluginLoader = require('./plugin');
const RexMethod = require('@clusic/method');
const BabelRegister = require("babel-register");
const LoaderCompile = require('@clusic/rex-loader');
const LifeCycles = Symbol('KoaWorkerService#LifeCycles');
const BuildComponents = Symbol('KoaWorkerService#BuildComponents');
const BabelTransformRegExp = Symbol('KoaWorkerService#BabelTransformRegExp');
require('reflect-metadata');

module.exports = class KoaWorkerService extends Koa {
  constructor(options = {}) {
    super();
    this.cwd = options.cwd || process.cwd();
    this.port = Number(options.port || 8080);
    this.env = options.env || process.env.NODE_ENV || 'development';
    this.cluster = options.cluster;
    this.type = options.type;
    this.name = options.name;
    this.Logger = console;
    this.connection = null;
    this.config = {};
    this.Router = new Route();
    this.Plugin = new PluginLoader(this, this.cwd, this.env, this.type, this.name);
    this.Loader = new LoaderCompile();
    this.Loader.addComponent(this.cwd);
    this.Loader.addCompiler(LoaderCompile.Controller(this));
    this.Loader.addCompiler(LoaderCompile.Middleware(this));
    this.Loader.addCompiler(LoaderCompile.Service(this));
    this[LifeCycles] = {};
    this[BabelTransformRegExp] = [];
    
    if (!this.cluster) {
      process.on('SIGTERM', this.stop.bind(this, 'SIGTERM'));
      process.on('SIGINT', this.stop.bind(this, 'SIGINT'));
      process.on('SIGQUIT', this.stop.bind(this, 'SIGQUIT'));
    }
    
    this.addBabelRule(/app\/controller\//);
  }
  
  async stop() {
    if (this.cluster) {
      this.kill();
    } else {
      await this.trigger('beforeStop');
      await this.trigger('stop');
      process.exit(0);
    }
  }
  
  addBabelRule(...args) {
    this[BabelTransformRegExp].push(...args);
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
  
  async createService() {
    const configFile = path.resolve(this.cwd, 'config', `config.${this.env}.js`);
    if (fs.existsSync(configFile)) {
      const configExports = utils.loadFile(configFile);
      if (typeof configExports === 'function') {
        this.config = await configExports(this);
      } else {
        this.config = configExports;
      }
    }
    const plugins = this.Plugin.analysis();
    for (let i = 0; i < plugins.length; i++) {
      this.Loader.addComponent(plugins[i].dir);
      if (typeof plugins[i].exports === 'function') {
        await plugins[i].exports(this, this.Plugin.maps[plugins[i].name]);
      }
    }
    if (this[BabelTransformRegExp].length) {
      BabelRegister({
        only: this[BabelTransformRegExp],
        extensions: [".js", ".mjs"],
        cache: true
      });
    }
    await this.Loader.compile();
    const appFile = path.resolve(this.cwd, 'app.bootstrap.js');
    if (fs.existsSync(appFile)) {
      const appExports = utils.loadFile(appFile);
      if (typeof appExports === 'function') {
        await appExports(this);
      }
    }
    await this.trigger('routing');
    await this[BuildComponents]();
    this.use(this.Router.routes());
    this.use(this.Router.allowedMethods());
    await this.trigger('beforeStart');
    this.connection = http.createServer(this.callback());
    await this.trigger('starting');
    await new Promise((resolve, reject) => {
      const port = this.port;
      this.connection.listen(port, err => {
        if (err) return reject(err);
        utils.checkPortCanUse(port).then(_port => {
          if (_port === port) {
            this.connection.close();
            return reject(new Error(`Server start at ${port} failed.`));
          }
          const url = `http://127.0.0.1:${port}`;
          this.Logger.info(`🎉 [${new Date().toLocaleString()}] 🔥 <${this.name}> server run at: ${url}`);
          resolve();
        }).catch(reject);
      });
    });
    this.bind('stop', () => this.connection.close());
    await this.trigger('started');
    return this;
  }
  
  async [BuildComponents]() {
    const controllers = global.CLUSIC_ROUTER_COMPONENTS;
    for (let i = 0; i < controllers.length; i++) {
      const $router = new Route();
      const controller = controllers[i];
      const prefix = Reflect.getMetadata('Controller', controller);
      const uses = Reflect.getMetadata('Use', controller);
      if (!prefix) continue;
      for (const property of Object.getOwnPropertyNames(controller.prototype)) {
        if (property === 'constructor') continue;
        const result = [];
        const middleware = Reflect.getOwnMetadata('Middleware', controller.prototype[property]);
        const extras = Reflect.getOwnMetadata('Middleware', controller.prototype[property]);
        const getters = RexMethod.Methods.map(method => {
          const httpMethodMetadata = Reflect.getOwnMetadata(method, controller.prototype[property]);
          if (!httpMethodMetadata) return;
          httpMethodMetadata.method = method;
          return httpMethodMetadata;
        }).filter(properties => !!properties);
        if (!getters.length) continue;
        if (getters.length > 1) {
          throw new Error(`You can not set multi HTTP methods on '${property}: ${getters.map(getter => getter.method).join(',')}'`);
        }
        const getter = getters[0];
        if (middleware) {
          for (let n = 0; n < middleware.length; n++) {
            result.push(RexMethod.RenderMiddlewareArguments(
              this.Middleware, 
              middleware[n]
            ));
          }
        }
        await this.trigger('decorate', { property, prefix, getter, extras, controller, result });
        result.push(async (ctx, next) => {
          const cacheClassObject = controller.__cacheClass__;
          if (cacheClassObject) {
            cacheClassObject.ctx = ctx;
            return await cacheClassObject[getter.property].call(cacheClassObject, ctx, next);
          }
          const obj = new controller(ctx);
          controller.__cacheClass__ = obj;
          return await obj[getter.property].call(obj, ctx, next);
        });
        $router[getter.method.toLowerCase()](getter.path, ...result);
      }
      const ControllerPrepareMiddlewares = uses 
        ? uses.map(middle => RexMethod.RenderMiddlewareArguments(this.Middleware, middle)) 
        : [];
      ControllerPrepareMiddlewares.push($router.routes());
      this.Router.use(prefix, ...ControllerPrepareMiddlewares);
    }
  }
};