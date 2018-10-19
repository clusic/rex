const path = require('path');
const master = require('@clusic/cluster');
const app = new master({
  cwd: __dirname,
  env: 'dev',
  agents: ['vs'],
  framework: path.resolve(__dirname, '..'),
  port: 3004,
  // socket: true,
  // max: 1
});

app.createServer().catch(e => app.kill());