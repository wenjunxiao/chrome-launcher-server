const http = require('http');
const net = require('net');
const urlParse = require('url').parse;
const sockProxy = require('./sock-proxy');

function addr2obj (addr) {
  if (addr) {
    if (/^(?:(\w+):\/\/)?([^:\/]+)(?::(\d+))?/.test(addr)) {
      return { protocol: RegExp.$1 || 'http', host: RegExp.$2, port: RegExp.$3 || null };
    }
    const [host, port] = addr.split(':');
    return { host, port: port || null };
  }
}

const system = addr2obj(process.env.PROXY_DEFAULT);
const host = process.env.PROXY_HOST || '127.0.0.1';
const port = parseInt(process.env.PROXY_PORT, 10) || 0;
const debug = process.env.PROXY_DEBUG === 'true' ? console.error.bind(console) : () => { };

const hosts = {};

function getProxy (domain, port) {
  let ip = hosts[domain + ':' + port] || hosts[domain];
  if (ip) {
    return {
      host: ip.host,
      port: ip.port || port
    };
  }
}

process.on('message', msg => {
  if (msg.type === 'add') {
    hosts[msg.domain] = addr2obj(msg.ip + ':' + (msg.port || ''));
  }
});

if (process.send) {
  const chunks = [];
  process.stdin.on('error', err => {
    console.error('stdin error =>', err);
  });
  process.stdin.on('data', buffer => {
    chunks.push(buffer);
  });
  process.stdin.on('end', buffer => {
    if (buffer) {
      chunks.push(buffer);
    }
    const data = Buffer.concat(chunks).toString('utf-8');
    try {
      const cfg = JSON.parse(data);
      debug('config from stdin => %s', data);
      Object.keys(cfg).forEach(n => {
        hosts[n] = addr2obj(cfg[n]);
      });
    } catch (err) {
      console.error('config error => %s', data, err);
    }
  });
} else {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.setPrompt('proxy> ');
  rl.on('line', line => {
    if (line === 'quit') process.exit(0);
    else if (line) {
      const args = line.split(' ');
      const cmd = args.shift();
      if (cmd === 'add') {
        hosts[args[0]] = addr2obj(args[1] + ':' + (args[2] || ''));
      } else if (cmd === 'print') {
        console.log(JSON.stringify(hosts));
      }
    }
    rl.prompt();
  }).on('close', () => {
    process.exit(0);
  });
}

const server = http.createServer((req, res) => {
  const url = urlParse(req.url);
  if (!url.port) {
    url.port = 80;
  }
  debug('request => %s %s:%s %s', req.method, url.hostname, url.port, url.host);
  url.headers = req.headers;
  url.method = req.method;
  let isProxy = false;
  const p = getProxy(url.hostname, url.port);
  if (p) {
    debug('request proxy => %s:%s %s:%s', url.hostname, url.port, p.host, p.port);
    url.hostname = p.host;
    url.port = p.port;
  } else if (system) {
    debug('request system => %s:%s %s:%s', url.hostname, url.port, system.host, system.port);
    url.hostname = system.host;
    if (system.port) {
      url.port = system.port;
      isProxy = true;
    }
  }
  const proxy = new net.Socket();
  proxy.on('error', err => {
    debug('request error => %s', req.url, err);
    req.destroy(err);
    try {
      proxy.destroy();
    } catch (_) { }
  });
  proxy.once('proxy-ready', () => {
    const headers = [`${req.method} ${url.href} HTTP/${req.httpVersion}\r\n`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headers.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
    }
    proxy.write(headers.join(''));
    proxy.write('\r\n');
    proxy.on('data', chunk => {
      req.socket.write(chunk);
    });
    proxy.on('end', chunk => {
      if (chunk && req.socket.writable) {
        req.socket.write(chunk);
      }
      req.socket.end();
    });
    req.on('data', chunk => {
      proxy.write(chunk);
    });
    req.on('end', () => {
      proxy.write('\r\n');
    });
    req.on('close', () => {
      proxy.end();
    });
  });
  proxy.connect(url.port, url.hostname, () => {
    if (isProxy) {
      if (/^sock/.test(system.protocol)) {
        const [host, port] = url.host.split(':');
        sockProxy(host, port || 80, proxy, system.protocol).then(proxy => {
          proxy.emit('proxy-ready');
        }).catch(err => {
          proxy.emit('error', err);
        });
      } else {
        proxy.write(`CONNECT ${url.host} HTTP/1.1\r\n\r\n`);
        proxy.once('data', chunk => {
          if (!(/Connection\s*established/i.test(chunk.toString()))) {
            req.socket.write(chunk);
            req.socket.end();
            return proxy.destroy();
          }
          proxy.emit('proxy-ready');
        });
      }
    } else {
      proxy.emit('proxy-ready');
    }
  });
});

server.listen(port, host, () => {
  if (process.send) {
    process.send({ type: 'ready', address: server.address() });
  } else {
    console.error('listen => %j', server.address());
  }
});

server.on('connect', (req, client, head) => {
  debug('connect => %s %s', req.method, req.url);
  let port = 443;
  let host = req.url;
  if (/^([^:]+)(?::([0-9]+))?$/.test(req.url)) {
    host = RegExp.$1;
    if (RegExp.$2) {
      port = parseInt(RegExp.$2)
    }
  }
  let isProxy = false;
  const p = getProxy(host, port);
  if (p) {
    debug('connect proxy => %s %s:%s', req.url, p.host, p.port);
    host = p.host;
    port = p.port;
  } else if (system) {
    debug('connect system => %s %s:%s', req.url, system.host, system.port);
    host = system.host;
    if (system.port) {
      port = system.port;
      isProxy = true;
    }
  }
  const proxy = new net.Socket();
  proxy.on('error', err => {
    if (!proxy.ended) {
      debug('proxy error => %s', req.url, err);
      proxy.ended = true;
    }
    if (!client.ended) {
      client.ended = true;
      client.destroy(err);
    }
  });
  proxy.on('end', () => {
    if (!proxy.ended) {
      debug('proxy end => %s', req.url);
      proxy.ended = true;
    }
    if (!client.ended) {
      client.ended = true;
      client.end();
    }
  });
  proxy.on('close', () => {
    if (!proxy.ended) {
      debug('proxy close => %s', req.url);
      proxy.ended = true;
    }
    if (!client.ended) {
      client.ended = true;
      client.end();
    }
  });
  client.on('error', err => {
    if (!client.ended) {
      debug('client error => %s', req.url, err);
      client.ended = true;
    }
    if (!proxy.ended) {
      proxy.ended = true;
      proxy.destroy(err);
    }
  });
  client.on('end', () => {
    if (!client.ended) {
      debug('client end => %s', req.url);
      client.ended = true;
    }
    if (!proxy.ended) {
      proxy.ended = true;
      proxy.end();
    }
  });
  client.on('close', () => {
    if (!client.ended) {
      debug('client close => %s', req.url);
      client.ended = true;
    }
    if (!proxy.ended) {
      proxy.ended = true;
      proxy.end();
    }
  });
  proxy.connect(port, host, () => {
    if (!proxy.ended && !client.ended) {
      if (isProxy) {
        if (/^sock/.test(system.protocol)) {
          const [host, port] = req.url.split(':');
          sockProxy(host, port || 443, proxy, system.protocol).then(proxy => {
            proxy.pipe(client, { end: false });
            client.pipe(proxy, { end: false });
            client.write(`HTTP/${req.httpVersion} 200 Connection established\r\n\r\n`);
          }).catch(err => {
            proxy.emit('error', err);
          });
        } else {
          /**
           * target host is also proxy, use `CONNECT` to tell it to connect to the target host
           * */
          proxy.pipe(client, { end: false });
          proxy.write(`CONNECT ${req.url} HTTP/1.1\r\n`);
          if (head.length > 0) {
            proxy.write(head);
            if (!head.toString().endsWith('\r\n')) {
              proxy.write('\r\n');
            }
          }
          proxy.write('\r\n');
          client.pipe(proxy, { end: false });
        }
      } else {
        proxy.write(head);
        client.pipe(proxy, { end: false });
        client.write(`HTTP/${req.httpVersion} 200 Connection established\r\n\r\n`);
        proxy.pipe(client, { end: false });
      }
    }
  });
});