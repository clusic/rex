const KoaRouter = require('koa-router');
const HttpMethods = [
  'HEAD',
  'OPTIONS',
  'GET',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
  'SOCKET'
];

module.exports = class Router extends KoaRouter {
  constructor(options) {
    options.methods = HttpMethods;
    super(options);
  }

  socket(name, path, middleware) {
    let middleware;
    if (typeof path === 'string' || path instanceof RegExp) {
      middleware = Array.prototype.slice.call(arguments, 2);
    } else {
      middleware = Array.prototype.slice.call(arguments, 1);
      path = name;
      name = null;
    }
    this.register(path, ['socket'], middleware, { name: name });
    return this;
  };
}