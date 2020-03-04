const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const http = require('http');
const httpProxy = require('http-proxy');
const chromeLaunch = require('chrome-launcher');
const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');

const logger = require('log4js').getLogger('chrome');

const Chromes = {};
const Proxys = {};

function clearChromes () {
  return Promise.all(Object.keys(Chromes).map(id => {
    const chrome = Chromes[id];
    if (chrome) {
      delete Chromes[id];
      delete Proxys[id];
      logger.info('kill chrome =>', id, chrome);
      return new Promise(resolve => {
        const timer = setTimeout(resolve, 3000);
        chrome.kill().then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    };
  }));
}

function getChromeVersion (port) {
  return new Promise(resolve => {
    http.get(`http://127.0.0.1:${port}/json/version`, res => {
      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          return resolve(JSON.parse(rawData));
        } catch (err) {
          console.error('error version info =>', rawData, err);
          resolve();
        }
      });
    }).on('error', err => {
      console.error('get chrome version error =>', err);
      resolve();
    });
  });
}

function findVersionFromIds (ids) {
  while (ids.length > 0) {
    const id = ids.pop();
    const chrome = Chromes[id];
    if (chrome) {
      return getChromeVersion(chrome.port);
    }
  }
  return Promise.resolve();
}

function findChromeVersion (options, chromePath) {
  return new Promise(resolve => {
    findVersionFromIds(Object.keys(Chromes)).then(data => {
      if (data) {
        return resolve(data);
      } else {
        const launchOpts = {
          chromePath,
          chromeFlags: ['--headless', '--no-sandbox', '--use-mock-keychain']
        };
        if (options.flags) {
          try {
            launchOpts.chromeFlags = launchOpts.chromeFlags.concat(JSON.parse(decodeURIComponent(options.flags)));
          } catch (_) {
          }
        }
        return chromeLaunch.launch(launchOpts).then(chrome => {
          return getChromeVersion(chrome.port).then(data => {
            chrome.kill();
            resolve(data);
          });
        });
      }
    })
  });
}

function launchChrome (id, address, options, query) {
  if (Chromes[id]) {
    return Promise.resolve(Chromes[id]);
  }
  const launchOpts = Object.assign({ chromeFlags: [], handleSIGINT: false }, options, {
    port: parseInt(process.env.CHROME_PORT, 10) || 0
  });
  const headless = launchOpts.chromeFlags.indexOf('--headless') > -1;
  if (query.extensions) {
    const extensions = query.extensions.split(',').map(extension => {
      return path.resolve(__dirname, '..', 'extensions', extension);
    }).join(',');
    launchOpts.enableExtensions = true;
    if (headless) {
      launchOpts.chromeFlags.push('--disable-extensions-except=' + extensions);
    }
    launchOpts.chromeFlags.push('--load-extension=' + extensions);
  }
  if (query.pac && query.pac !== 'false') {
    launchOpts.chromeFlags.push('--proxy-pac-url=' + query.pac);
  }
  if (query.certificate === 'true') {
    launchOpts.chromeFlags.push('--no-sandbox');
    launchOpts.chromeFlags.push('--ignore-certificate-errors');
  }
  if (/^\w+:\/\//.test(decodeURIComponent(query.webProxy))) {
    launchOpts.chromeFlags.push('--proxy-server=' + decodeURIComponent(query.webProxy));
  } else if (query.webProxy && query.webProxy !== 'false') {
    try {
      query.webProxy = JSON.parse(Buffer.from(query.webProxy, 'base64').toString('utf-8'));
    } catch (_) {
      try {
        query.webProxy = JSON.parse(decodeURIComponent(query.webProxy));
      } catch (_) {
      }
    }
    if (typeof query.webProxy === 'object') {
      if (query.proxyDefault) {
        query.proxyDefault = decodeURIComponent(query.proxyDefault);
      }
      return launchProxy(query.webProxy, query.proxyDefault, query.debug).then(sub => {
        launchOpts.chromeFlags.push('--proxy-server=http://127.0.0.1:' + sub.address.port);
        query.webProxy = sub;
        return query;
      }).then(query => {
        return _launchChrome(id, address, launchOpts, query);
      });
    }
  }
  return _launchChrome(id, address, launchOpts, query);
}

function launchProxy (hosts, proxyDefault, debug) {
  const sub = spawn(process.execPath, [require.resolve('./web-proxy.js')], {
    stdio: ['pipe', 1, 2, 'ipc'],
    env: {
      PROXY_DEBUG: debug === 'true',
      PROXY_DEFAULT: proxyDefault
    }
  });
  return new Promise((resolve, reject) => {
    sub.once('error', reject);
    sub.on('message', msg => {
      if (msg.type === 'ready') {
        sub.address = msg.address;
        logger.debug('proxy server => %s %j', sub.pid, sub.address);
        return resolve(sub);
      }
    });
    sub.stdin.write(JSON.stringify(hosts));
    sub.stdin.end();
  });
}

function _launchChrome (id, { address, family }, launchOpts, query) {
  const headless = launchOpts.chromeFlags.indexOf('--headless') > -1;
  const PROXY_CHROME = process.env.PROXY_CHROME === 'true';
  const isLocal = address === '127.0.0.1';
  if (!PROXY_CHROME && (isLocal || headless) && query.proxy !== 'true') {
    if (headless) {
      launchOpts.chromeFlags.push('--remote-debugging-address=0.0.0.0');
    }
    logger.debug('start chrome => %s %j', headless, launchOpts);
    return chromeLaunch.launch(launchOpts).then(chrome => {
      chrome.time = new Date().toISOString();
      Chromes[id] = chrome;
      chrome._kill = chrome.kill;
      if (query.webProxy && query.webProxy.pid) {
        const sub = query.webProxy;
        chrome.pids = [sub.pid];
        chrome.kill = () => {
          delete Chromes[id];
          delete Proxys[id];
          return Promise.all([chrome._kill(), sub.kill()]);
        }
      } else {
        chrome.kill = () => {
          delete Chromes[id];
          delete Proxys[id];
          return chrome._kill();
        }
      }
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
      chrome.time = new Date().toISOString();
      chrome._kill = chrome.kill;
      if (query.webProxy && query.webProxy.pid) {
        const sub = query.webProxy;
        chrome.pids = [sub.pid];
        chrome.kill = () => {
          delete Chromes[id];
          delete Proxys[id];
          return Promise.all([chrome._kill(), proxyServer.close(), sub.kill()]);
        }
      } else {
        chrome.kill = () => {
          delete Chromes[id];
          delete Proxys[id];
          return Promise.all([chrome._kill(), proxyServer.close()]);
        }
      }
      Chromes[id] = chrome;
      fillChromeVersion(chrome);
      return chrome;
    });
  }
}

const sleep = s => new Promise(resolve => setTimeout(resolve, s * 1000))

function evalInChrome (chrome, url, expression, options) {
  options = options || {}
  if (typeof expression !== 'object') {
    expression = { expression, returnByValue: true };
  }
  return CDP({ host: '127.0.0.1', port: chrome.port }).then(client => {
    return Promise.all([client.Network.enable(), client.Page.enable()]).then(() => {
      return client.Page.navigate({ url });
    }).then(() => {
      return client.Page.loadEventFired();
    }).then(() => {
      if (options.waiting) {
        return sleep(options.waiting);
      }
    }).then(() => {
      return client.Runtime.evaluate(expression);
    }).then(result => {
      if (options.screenshot) {
        return client.Page.captureScreenshot({
          format: 'jpeg', // png or jpeg
          quality: 100, // jpeg only
          fromSurface: true
        }).then(rsp => {
          return {
            result: {
              type: 'jpeg',
              value: Buffer.from(rsp.data, 'base64').toString('binary')
            }
          }
        });
      }
      return result;
    });
  });
}

function loadConfig (dir) {
  return new Promise(resolve => {
    fs.readFile(path.resolve(dir, 'config.json'), (err, buffer) => {
      if (!err) {
        return resolve(JSON.parse(buffer.toString()));
      } else {
        return resolve({});
      }
    });
  })
}

function saveConfig (dir, config, reset = false) {
  return (reset ? Promise.resolve(config) : loadConfig(dir)).then(cfg => {
    config = _.merge(cfg, config);
    return new Promise(resolve => {
      fs.writeFile(path.resolve(dir, 'config.json'), Buffer.from(JSON.stringify(config), 'utf-8'), err => {
        if (err) return resolve(config);
        return resolve(config);
      })
    });
  });
}

module.exports = {
  Chromes,
  Proxys,
  clearChromes,
  findChromeVersion,
  launchChrome,
  evalInChrome,
  loadConfig,
  saveConfig
};
