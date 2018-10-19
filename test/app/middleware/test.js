module.exports = async (ctx, next) => {
  ctx.test = 123;
  await next();
};