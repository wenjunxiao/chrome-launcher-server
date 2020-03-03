const net = require('net');

module.exports = (host, port, proxy) => {
  return new Promise((resolve, reject) => {
    proxy.once('data', chunk => {
      if (chunk[0] !== 0x05) {
        return reject(new Error('Unexpected socks version: ' + chunk[0]));
      } else if (chunk[1] !== 0x00) {
        return reject(new Error('Unexpected authentication method: ' + chunk[1]));
      } else {
        const tmp = [
          0x05, // SOCK Version, 5
          0x01, // CMD: 0x01-CONNECT请求;0x02表示BIND请求(ftp协议);0x03-表示UDP转发
          0x00, // Reserved - must be 0x00
        ];
        // ATYP类型
        switch (net.isIP(host)) {
          case 0:
            tmp.push(0x03); // 0x03 hostname
            tmp.push(host.length);
            for (let b of Buffer.from(host).values()) {
              tmp.push(b);
            }
            break;
          case 4:
            tmp.push(0x01); // IPv4
            host.split('.').forEach(v => {
              tmp.push(parseInt(v, 10));
            });
            break;
          case 6:
            tmp.push(0x04); // IPv6
            host.split(':').forEach(v => {
              tmp.push(parseInt(v.substr(0, 2), 16));
              tmp.push(parseInt(v.substr(2, 2), 16));
            });
            break;
        }
        tmp.push(0x00, 0x00);
        const buf = Buffer.from(tmp);
        buf.writeUInt16BE(parseInt(port, 10), buf.length - 2);
        proxy.once('data', chunk => {
          if (chunk[0] !== 0x05) {
            reject(new Error('Unexpected socks version: ' + chunk[0]));
          } else if (chunk[1] !== 0x00) {
            reject(new Error('Connection error: ' + chunk[1]));
          } else if (chunk[2] !== 0x00) {
            reject(new Error('The reserved byte must be 0x00: ' + chunk[2]));
          } else {
            return resolve(proxy);
          }
        });
        proxy.write(buf);
      }
    });
    // authentication negotiation
    proxy.write(Buffer.from([
      0x05, // SOCK Version, 5
      0x01, // Number of authentication methods
      0x00, // authentication methods:0x00-不需要认证;0x01-GSSAPI;0x02-用户名密码认证
    ]));
  });
};
