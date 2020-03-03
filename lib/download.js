const _ = require('lodash');
const fs = require('fs');
const urlParse = require('url').parse;
const http = require('http');
const https = require('https');
const logger = require('log4js').getLogger('download');

function download (url, filePath, start, progress) {
  const opts = _.pick(urlParse(url), ['hostname', 'port', 'path', 'protocol'])
  if (/^https/.test(opts.protocol)) {
    opts.port = opts.port || 443
  } else {
    opts.port = opts.port || 80;
  }
  logger.debug('download => %s %s', url, !!progress);
  const request = /^https/.test(opts.protocol) ? https.request : http.request;
  opts.headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Connection': 'keep-alive',
    'Content-Type': 'application/octet-stream',
    'Range': `bytes=${start}-`
  };
  opts.agent = null;
  return new Promise((resolve, reject) => {
    request(opts, res => {
      logger.debug('downloading =>', url, res.statusCode);
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) > -1) {
        return download(res.headers['location'], filePath, start, progress).then(resolve, reject);
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        const stream = fs.createWriteStream(filePath, {
          flags: start > 0 ? 'a' : 'w'
        });
        res.on('error', reject);
        if (progress) {
          let size = start || 0;
          let total = size + parseInt(res.headers['content-length'], 10);
          res.on('data', (buf) => {
            size = size + buf.length;
            stream.write(buf);
            progress(size / total);
          });
        } else {
          res.pipe(stream);
        }
        res.on('end', () => {
          resolve();
        });
      } else if (res.statusCode === 416) {
        resolve();
      } else {
        reject(new Error('invalid status[' + res.statusCode + ']'));
      }
    }).on('error', reject).end();
  });
}
module.exports = download;