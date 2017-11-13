#!/usr/bin/env node

const _ = require('lodash');
const path = require('path');
const glob = require('glob');
const log4js = require('log4js');
const program = require('commander');
const logger = log4js.getLogger('chrome-server');

const BASE_PATH = process.cwd();
program
  .version('0.1.0')
  .allowUnknownOption()
  .option('-h, --host [host]', 'listen address', '0.0.0.0')
  .option('-p, --port [port]', 'listen port', parseInt, 0)
  .option('-v, --verbose', 'verbose')
  .option('-c, --config [configFile]', 'config file to load')
  .parse(process.argv);

/**
 * 默认日志配置
 */
const logConfig = {
  replaceConsole: true,
  appenders: {
    out: { type: 'stdout' }
  },
  categories: {
    default: { appenders: ['out'], level: program.verbose && 'trace' || 'debug' }
  }
};

/**
 * 配置信息,从当前运行目录加载配置
 */
let configs = [{
  log4js: logConfig,
  port: program.port || parseInt(process.env.PORT, 0) || 0,
  host: program.host
}];
if (program.config) {
  // 从配置文件中加载
  configs = configs.concat(glob.sync(program.config).map((file) => {
    return require(path.resolve(BASE_PATH, file));
  }));
}

const config = _.merge.apply(null, configs);
/**
 * 启用日志配置信息
 */
log4js.configure(config.log4js);

logger.trace('starting...');
const ChromeServer = require('../lib/server').ChromeServer;
const server = new ChromeServer(config);
server.listen(config.port, config.host, (err) => {
  if (err) {
    return logger.error('Server start error', err);
  }
  const addr = server.address();
  logger.debug('listen => %s:%s', addr.address, addr.port);
  logger.debug('server started in `%s`', BASE_PATH);
});
