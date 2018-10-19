const { ContextService } = require('@clusic/method');
module.exports = class ABC extends ContextService {
  constructor(ctx) {
    super(ctx);
    this.a = 'evio';
  }
  
  async ooo() {
    const value = await this.app.feed('vs', 'am', 'iii');
    return this.a + this.ctx.test + value;
  }
};