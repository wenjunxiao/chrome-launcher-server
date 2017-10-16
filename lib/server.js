'use strict';

const Koa = require('koa');
const route = require('koa-route');
const bodyParser = require('koa-bodyparser');
const http = require('http');
const httpProxy = require('http-proxy');
const chromeLaunch = require('chrome-launcher');
const logger = require('log4js').getLogger('chrome-server');

const Chromes = {};

async function launchChrome(address, options) {
  if (address.address === '127.0.0.1') {
    const chrome = await chromeLaunch.launch(Object.assign({}, options || {}, {
      port: 0,
      handleSIGINT: false
    }));
    return chrome;
  } else {
    const proxyServer = http.createServer();
    await new Promise((resolve, reject) => {
      proxyServer.listen(0, address.address, address.family, () => {
        resolve(proxyServer);
      })
    });
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
    const chrome = await chromeLaunch.launch(Object.assign({}, options || {}, {
      port: addr.port,
      handleSIGINT: false
    }));
    return {
      pid: chrome.pid,
      port: chrome.port,
      async kill() {
        await chrome.kill();
        await proxyServer.close()
      }
    };
  }
}

class ChromeServer {

  constructor(options) {
    this.options = options;
    const app = this.app = new Koa();
    app.use(bodyParser());
    app.use(route.post('/api/launch/:id', this._launch));
    app.use(route.post('/api/kill/:id', this._kill));
  }

  listen(port, host, callback) {
    let self = this;
    this.app.listen(port, host, function(...args){
      self._address = this.address.bind(this);
      return callback && callback(...args);
    });
    return this;
  }

  address() {
    return this._address && this._address();
  }

  async _launch(ctx, id, next) {
    const address = ctx.socket.address();
    logger.info('launch request =>', id, address);
    const chrome = await launchChrome(address, ctx.request.body);
    Chromes[id] = chrome;
    logger.debug('chrome lauched=>', chrome);
    ctx.body = {
      success: true,
      data: {
        port: chrome.port
      }
    };
  }

  async _kill(ctx, id) {
    const body = ctx.req.body || {};
    logger.info('kill request =>', id, body);
    const chrome = Chromes[id];
    if (chrome) await chrome.kill();
    delete Chromes[id];
    ctx.body = {
      success: true
    };
  }
}

module.exports.ChromeServer = ChromeServer;
