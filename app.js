'use strict';
/**
 * Chrome代理服务管理
 */
require('babel-core/register');
require('babel-polyfill');
const _ = require('lodash');
const glob = require('glob');
const log4js = require('log4js');
const logger = log4js.getLogger('chrome-server');

/**
 * 默认日志配置
 */
const logConfig = {
  replaceConsole: true,
  appenders: {
    out: { type: 'stdout' }
  },
  categories: {
    default: { appenders: ['out'], level: 'debug' }
  }
};

/**
 * 环境变量
 */
const env = process.env.NODE_ENV || 'development';

/**
 * 配置信息
 */
const config = _.merge.apply(null, [{
  log4js: logConfig,
  port: 0,
  host: '0.0.0.0'
}].concat(
  glob.sync(`${__dirname}/config/*.js`)
    .concat(glob.sync(`${__dirname}/config/env/${env}.js`))
    .concat(glob.sync(`${__dirname}/config/local.js`))
    .map(require)
  )
);

/**
 * 启用日志配置信息
 */
log4js.configure(config.log4js);

logger.debug('Starting...');
logger.debug('Environment : %s', env);

const ChromeServer = require('./lib/server').ChromeServer;
const server = new ChromeServer(config);
server.listen(config.port, config.host, (err) => {
  if (err) {
    return logger.error('Server start error', err);
  }
  logger.debug('Port        : %s', server.address().port);
  logger.debug('Server started in `%s`', __dirname);
});
