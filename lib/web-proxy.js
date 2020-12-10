const proxyServer = require('./proxy-server');

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
const server = proxyServer(system, getProxy);
server.listen(port, host, ()=>{
  if (process.send) {
    process.send({ type: 'ready', address: server.address() });
  } else {
    console.error('listen => %j', server.address());
  }
});
