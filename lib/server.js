'use strict';

const Koa = require('koa');
const convert = require('koa-convert');
const route = require('koa-route');
const bodyParser = require('koa-bodyparser');
const http = require('http');
const httpProxy = require('http-proxy');
const chromeLaunch = require('chrome-launcher');
const logger = require('log4js').getLogger('chrome-server');

const Chromes = {};

function clearChromes() {
  return Promise.all(Object.keys(Chromes).map(id => {
    const chrome = Chromes[id];
    if (chrome) {
      logger.info('kill chrome =>', id, chrome);
      return chrome.kill();
    };
  }));
}

function launchChrome(id, { address, family, port }, options) {
  const launchOpts = Object.assign({ chromeFlags: [], handleSIGINT: false }, options, {
    port: parseInt(process.env.CHROME_PORT, 10) || 0
  })
  const PROXY_CHROME = process.env.PROXY_CHROME === 'true';
  const isLocal = address === '127.0.0.1';
  const headless = launchOpts.chromeFlags.indexOf('--headless') > -1;
  if (!PROXY_CHROME && (isLocal || headless)) {
    if (headless) {
      launchOpts.chromeFlags.push(`--remote-debugging-address=0.0.0.0`);
    }
    logger.debug('start chrome => %s %j', headless, launchOpts);
    return chromeLaunch.launch(launchOpts).then(chrome => {
      Chromes[id] = chrome;
      return chrome;
    });
  } else {
    const proxyServer = http.createServer();
    return Promise.resolve(new Promise(resolve => {
      proxyServer.listen(launchOpts.port, address, family, () => {
        resolve(proxyServer);
      })
    })).then(proxyServer => {
      const addr = proxyServer.address();
      logger.info('launch proxy =>', addr);
      const proxy = new httpProxy.createProxyServer({
        target: {
          host: '127.0.0.1',
          port: addr.port
        }
      });
      proxyServer.on('request', function (req, res) {
        logger.debug('proxy request =>', req.url);
        proxy.web(req, res);
      });
      proxyServer.on('upgrade', function (req, socket, head) {
        logger.debug('proxy upgrade=>', req.url);
        proxy.ws(req, socket, head);
      });
      proxy.on('error', (error) => {
        logger.debug('proxy error=>', error);
        proxyServer.close();
        proxy.close();
      });
      launchOpts.port = addr.port;
      logger.debug('start chrome => %j', launchOpts);
      return chromeLaunch.launch(launchOpts);
    }).then((chrome) => {
      Chromes[id] = chrome;
      return {
        pid: chrome.pid,
        port: chrome.port,
        kill() {
          return Promise.all([chrome.kill(), proxyServer.close()]);
        }
      };
    });
  }
}

class ChromeServer {

  constructor(options) {
    this.options = options;
    const app = this.app = new Koa();
    app.use(convert(bodyParser()));
    app.use(route.post('/api/launch/:id', this._launch));
    app.use(route.post('/api/kill/:id', this._kill));
  }

  listen(port, host, callback) {
    let self = this;
    const listeners = {
      sigusr2: function () {
        logger.info('sigusr2');
        clearChromes().then(() => {
          process.kill(process.pid, 'SIGUSR2');
        });
      },
      sigint: function () {
        logger.info('sigint');
        clearChromes().then(() => {
          process.exit();
        });
      },
      sigterm: function () {
        logger.info('sigterm');
        clearChromes().then(() => {
          process.exit();
        });
      },
      exit: function () {
        logger.info('exit');
      }
    };
    process.once('SIGUSR2', listeners.sigusr2);
    process.on('SIGINT', listeners.sigint);
    process.on('SIGTERM', listeners.sigterm);
    process.on('exit', listeners.exit);
    this.app.listen(port, host, function (...args) {
      self._address = this.address.bind(this);
      return callback && callback(...args);
    });
    return this;
  }

  address() {
    return this._address && this._address();
  }

  _launch(ctx, id, next) {
    const address = ctx.socket.address();
    const options = ctx.request.body;
    logger.info('launch request =>', id, address);
    return launchChrome(id, address, options).then(chrome => {
      logger.info('chrome lauched =>', chrome);
      ctx.body = {
        success: true,
        data: {
          id: id,
          port: chrome.port
        }
      };
    }).catch(err => {
      logger.error('launch error =>', id, options, err);
      ctx.body = {
        success: false,
        error: {
          message: err.message || err.toString()
        }
      };
    });
  }

  _kill(ctx, id) {
    const body = ctx.req.body || {};
    logger.info('kill request =>', id, body);
    const chrome = Chromes[id];
    delete Chromes[id];
    if (chrome) chrome.kill();
    ctx.body = {
      success: true,
      data: {
        id: id
      }
    };
  }
}

module.exports.ChromeServer = ChromeServer;
