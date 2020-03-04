'use strict';

const _ = require('lodash');
const path = require('path');
const Koa = require('koa');
const convert = require('koa-convert');
const route = require('koa-route');
const bodyParser = require('koa-bodyparser');
const Zip = require('jszip');
const logger = require('log4js').getLogger('server');
const Pac = require('./web-pac');
const download = require('./download');
const {
  Chromes, Proxys,
  clearChromes, findChromeVersion,
  evalInChrome, launchChrome,
  loadConfig, saveConfig
} = require('./chrome');
const {
  unlink, rmdirp,
  getFileSize,
  readFile,
  writeFile,
  ensureDir
} = require('./utils');

const Installings = {};

class ChromeServer {

  constructor(options) {
    this.options = options || {};
    this.chrome = this.options.chrome || path.resolve(process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE, '.chrome-server');
    const self = this;
    loadConfig(self.chrome).then(cfg => {
      if (cfg.enabled) {
        self.stableChrome = cfg.stable;
        self.chromeInstalls = cfg.installs;
      }
    });
    const app = this.app = new Koa();
    const startup = new Date();
    app.use(convert(bodyParser()));
    app.use(route.post('/api/launch/:id', this._launch.bind(this)));
    app.use(route.post('/api/kill/:id', this._kill));
    app.use(route.get('/api/chromes', function (ctx) {
      ctx.body = {
        success: true,
        data: {
          chromes: Chromes
        }
      };
    }));
    app.use(route.get('/', function (ctx) {
      ctx.body = [
        'Chrome Server',
        'Version: ' + require('../package.json').version,
        'Startup: ' + startup.toISOString()
      ].join('\n');
    }));
    app.use(route.post('/api/clear', function (ctx) {
      logger.debug('[%s] clear request');
      return clearChromes().then(() => {
        ctx.body = {
          success: true
        };
      });
    }));
    app.use(route.post('/api/exit', function (ctx) {
      const code = parseInt(ctx.request.query.code || ctx.request.body.code, 10) || 0;
      logger.debug('[%s] exit request =>', code);
      return clearChromes().then(() => {
        ctx.body = {
          success: true
        };
        setTimeout(() => {
          process.exit(code)
        }, ctx.request.query.timeout || ctx.request.body.timeout || 1000);
      });
    }));
    app.use(route.get('/api/version', function (ctx) {
      logger.trace('[%s] version request', ctx.ip);
      return findChromeVersion(ctx.request.query, self.stableChrome).then((data) => {
        ctx.body = {
          data: {
            version: require('../package.json').version,
            startup: startup.toISOString(),
            chrome: data
          },
          success: true
        };
      });
    }));
    app.use(route.get('/api/pac/:id.pac', function (ctx, id) {
      logger.trace('[%s] pac request => %s', ctx.ip, id);
      ctx.body = Proxys[id] || Pac.empty;
    }));
    app.use(route.get('/api/proxy/:ip', function (ctx, ip) {
      const encoding = (ctx.request.query.encoding || '').toLowerCase();
      let url = ctx.request.query.url;
      let hosts = ctx.request.query.hosts || '';
      let expression = ctx.request.query.exp || 'document.documentElement.outerHTML';
      let chromeFlags = ctx.request.query.flags || '';
      let usePac = ctx.request.query.pac === 'true';
      url = decodeURIComponent(url);
      hosts = decodeURIComponent(hosts);
      expression = decodeURIComponent(expression);
      chromeFlags = decodeURIComponent(chromeFlags);
      if (encoding) {
        url = Buffer.from(url, encoding).toString('utf-8');
        hosts = Buffer.from(hosts, encoding).toString('utf-8');
        expression = Buffer.from(expression, encoding).toString('utf-8');
        chromeFlags = Buffer.from(chromeFlags, encoding).toString('utf-8');
      }
      if (hosts) {
        try {
          hosts = JSON.parse(hosts);
        } catch (err) {
          hosts = {};
        }
      } else {
        hosts = {};
      }
      if (/^\w+:\/\/([^:\/]+)/.test(url) && /^[\d.]+$/.test(ip)) {
        hosts[RegExp.$1] = ip;
      }
      if (chromeFlags) {
        try {
          chromeFlags = JSON.parse(chromeFlags);
        } catch (err) {
          chromeFlags = [];
        }
      } else {
        chromeFlags = [];
      }
      if (ctx.request.query.headless !== 'false') {
        chromeFlags.push('--headless');
      }
      const id = 'T' + Date.now() + '.' + Buffer.from(url, 'utf-8').toString('base64');
      const query = {
        debug: ctx.request.query.debug,
        proxyDefault: ctx.request.query.proxyDefault
      };
      if (Object.keys(hosts).length > 0) {
        if (usePac) {
          const addr = self.address();
          query.pac = `http://${addr.address}:${addr.port}/api/pac/${id}.pac`;
          Proxys[id] = Pac.hosts2pac(hosts);
        } else {
          query.webProxy = hosts;
        }
      }
      try {
        if (/^base64\W+(.*)$/.test(expression)) {
          expression = Buffer.from(RegExp.$1, 'base64').toString('utf-8');
        }
        expression = JSON.parse(expression);
      } catch (_) {
      }
      const options = { chromeFlags }
      if (self.stableChrome) {
        options.chromePath = self.stableChrome;
      } else if (query.chromeVersion && self.chromeInstalls) {
        options.chromePath = self.chromeInstalls[query.chromeVersion].exe;
      }
      return launchChrome(id, { address: '127.0.0.1' }, options, query).then(chrome => {
        return evalInChrome(chrome, url, expression, {
          waiting: parseInt(ctx.request.query.waiting, 10) || 0,
          screenshot: ctx.request.query.screenshot === 'true'
        }).then(rsp => {
          if (ctx.request.query.debug === 'true') {
            logger.info('proxy response => %j %j', expression, rsp);
          }
          if (ctx.request.query.valueOnly === 'true') {
            if (rsp.result.type === 'string') {
              ctx.set('Content-Type', 'text/html');
              ctx.body = rsp.result.value;
            } else if (rsp.result.type === 'jpeg') {
              ctx.type = 'jpeg';
              ctx.body = Buffer.from(rsp.result.value, 'binary');
            } else {
              ctx.body = rsp.result.value;
            }
          } else {
            ctx.body = {
              success: true,
              data: rsp.result
            };
          }
          if (ctx.request.query.keep !== 'true') {
            chrome.kill();
          }
        });
      }).catch(err => {
        logger.error('proxy error =>', ip, url, err);
        if (ctx.request.query.valueOnly === 'true') {
          ctx.set('Content-Type', 'text/html');
          ctx.body = err.message + '\n' + err.stack;
        } else {
          ctx.body = {
            success: false,
            error: {
              message: err.message,
              stack: err.stack
            }
          };
        }
      });
    }));
    app.use(route.get('/api/chrome/config', function (ctx) {
      return loadConfig(self.chrome).then(config => {
        ctx.body = config
      });
    }));
    app.use(route.post('/api/chrome/config', function (ctx) {
      return saveConfig(self.chrome, _.pick(ctx.request.body, ['enabled', 'stable'])).then(config => {
        ctx.body = config
        if (config.enabled) {
          this.stableChrome = config.stable;
          this.chromeInstalls = config.installs;
        } else {
          this.stableChrome = null;
          this.chromeInstalls = null;
        }
        logger.debug('chrome config => %j', config);
      });
    }));
    app.use(route.all('/api/chrome/:version/install', function (ctx, version) {
      if (ctx.request.method === 'GET') {
        ctx.body = Installings[version] || {
          message: 'not found'
        };
        return;
      }
      const force = ctx.request.body.force;
      if (!ctx.request.body.exe || !ctx.request.body.url || !version) {
        ctx.body = {
          error: {
            message: '缺少参数[exe,url,version]'
          }
        }
        return;
      } else if (Installings[version] && !force) {
        ctx.body = Installings[version];
        return;
      }
      const info = Installings[version] = {
        url: ctx.request.body.url,
        exe: ctx.request.body.exe,
        start: Date.now()
      };
      ctx.body = info;
      const filepath = path.resolve(self.chrome, version + '.zip');
      ensureDir(self.chrome).then(() => {
        if (force) {
          return download(info.url, filepath, 0, (percentage) => {
            info.percentage = percentage;
          });
        } else {
          return getFileSize(filepath).then(size => {
            return download(info.url, filepath, size, (percentage) => {
              info.percentage = percentage;
            });
          });
        }
      }).then(() => {
        info.download = Date.now();
        let zip = new Zip();
        return readFile(filepath).then(buffer => {
          return zip.loadAsync(buffer);
        });
      }).then(zip => {
        const filenames = Object.keys(zip.files);
        const prefix = filenames.filter(filename => !filename.startsWith(filenames[0])).length > 0 ? '' : filenames[0];
        return Promise.all(filenames.map(filename => {
          const file = zip.file(filename);
          if (!file) {
            return Promise.resolve(file);
          }
          return file.async('nodebuffer').then(content => {
            const dest = path.resolve(self.chrome, version, filename.substr(prefix.length));
            const dir = path.dirname(dest);
            return ensureDir(dir).then(() => {
              return writeFile(dest, content, {
                mode: file.unixPermissions || file.dosPermissions
              });
            });
          });
        }));
      }).then(() => {
        return saveConfig(self.chrome, {
          installs: {
            [version]: {
              exe: path.resolve(self.chrome, version, info.exe)
            }
          }
        });
      }).then(cfg => {
        if (cfg.enabled) {
          this.chromeInstalls = cfg.installs
        }
        info.end = Date.now();
        info.done = true;
        logger.debug('chrome install done =>', version, info.url);
      }).catch(err => {
        logger.error('chrome install error =>', version, info.url, err);
        info.message = err.message;
        info.done = true;
      });
    }));
    app.use(route.post('/api/chrome/:version/apply', function (ctx, version) {
      return loadConfig(self.chrome).then(cfg => {
        const vc = cfg.installs[version];
        if (vc) {
          cfg.stable = vc.exe;
          if (cfg.enabled) {
            self.stableChrome = cfg.stable;
          }
          logger.debug('chrome apply =>', version);
        }
        return saveConfig(self.chrome, cfg);
      }).then(cfg => {
        ctx.body = cfg;
      });
    }));
    app.use(route.post('/api/chrome/:version/uninstall', function (ctx, version) {
      logger.debug('chrome uninstall =>', version);
      delete Installings[version];
      return Promise.all([
        unlink(path.resolve(self.chrome, version + '.zip')),
        rmdirp(path.resolve(self.chrome, version))
      ]).catch(() => {
        return Promise.resolve(true);
      }).then(() => {
        return loadConfig(self.chrome)
      }).then(cfg => {
        const vc = cfg.installs[version];
        if (vc && cfg.stable === vc.exe) {
          cfg.stable = null;
          self.stableChrome = null;
        }
        delete cfg.installs[version];
        return saveConfig(self.chrome, cfg, true);
      }).then(() => {
        ctx.body = {
          success: true
        };
      });
    }));
  }

  listen (port, host, callback) {
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

  address () {
    return this._address && this._address();
  }

  _launch (ctx, id) {
    const address = ctx.socket.address();
    const options = ctx.request.body;
    const query = ctx.request.query || {};
    logger.info('[%s] launch request => %s %j %j', ctx.ip, id, address, query);
    if (query.pac && query.pac !== 'false' && !(/^http/i.test(query.pac))) {
      if (query.pac === 'true') {
        Proxys[id] = Pac.empty();
      } else {
        try {
          const hosts = JSON.parse(decodeURIComponent(query.pac));
          Proxys[id] = Pac.hosts2pac(hosts);
        } catch (err) {
          try {
            const hosts = JSON.parse(Buffer.from(query.pac, 'base64').toString('utf-8'));
            Proxys[id] = Pac.hosts2pac(hosts);
          } catch (err) {
            Proxys[id] = decodeURIComponent(query.pac);
          }
        }
      }
      const addr = this.address();
      if (/^[0.:]+$/.test(addr.address)) {
        addr.address = '127.0.0.1'
      }
      query.pac = `http://${addr.address}:${addr.port}/api/pac/${id}.pac`;
    }
    if (this.stableChrome) {
      options.chromePath = this.stableChrome;
    } else if (query.chromeVersion && this.chromeInstalls) {
      options.chromePath = this.chromeInstalls[query.chromeVersion].exe;
    }
    return launchChrome(id, address, options, query).then(chrome => {
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

  _kill (ctx, id) {
    const body = ctx.req.body || {};
    logger.info('[%s] kill request =>', ctx.ip, id, body);
    const chrome = Chromes[id];
    delete Chromes[id];
    delete Proxys[id];
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
