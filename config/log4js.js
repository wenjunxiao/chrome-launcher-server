'use strict';
/**
 * log4js 配置
 */

module.exports.log4js = {
  replaceConsole: true,
  appenders: {
    out: { type: 'stdout' }
  },
  categories: {
    default: { appenders: ['out'], level: 'debug' }
  }
};

