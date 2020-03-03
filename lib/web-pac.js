const hostFindProxyForURL = () => (function FindProxyForURL (url, host) {
  if (/^\w+:\/\/([^:\/]+)(?:\:(\d+))?/.test(url)) {
    var domain = RegExp.$1;
    var port = RegExp.$2;
    if (port) {
      var ip = hosts[domain + ':' + port] || hosts[domain];
      if (ip) {
        if (ip.indexOf(':') > 0) {
          return `PROXY ${ip}; DIRECT;`;
        }
        return `PROXY ${ip}:${port}; DIRECT;`;
      }
    } else {
      var ip = hosts[domain];
      if (ip) {
        if (ip.indexOf(':') > 0) {
          return `PROXY ${ip}; DIRECT;`;
        }
        return `PROXY ${ip}:80; DIRECT;`;
      }
    }
  }
  return "DIRECT;";
});
const hosts2pac = hosts => `var hosts = ${JSON.stringify(hosts)};\n${hostFindProxyForURL()}`
const emptyPac = 'function FindProxyForURL(url, host){return "DIRECT;";}';

module.exports = {
  hosts2pac,
  empty () {
    return emptyPac;
  }
};