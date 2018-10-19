const { Controller, Get, Middleware, ControllerService } = require('@clusic/method');

@Controller('/api')
class AControllerService extends ControllerService {
  constructor(ctx) {
    super(ctx);
  }
  
  @Get('/user/:id(\\d+)')
  @Middleware('Test')
  async user() {
    const result = await this.Service.Abc.ooo();
    this.ctx.body = 'in classic:' + result;
  }
}

module.exports = Controller;