module.exports = async function(app) {
  app.Logger.info('run in ' + app.name);
  app.feed('am', (data) => {
    return data + 'test:evio';
  });
};