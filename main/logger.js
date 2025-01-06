const { createLogger, format, transports } = require('winston');
const path = require('path');

function getCallerInfo() {
  const originalLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;

  const err = new Error();
  Error.captureStackTrace(err, getCallerInfo);
  const stackLines = err.stack.split('\n');

  // 可以暫時 debug 看看整個 stack 是什麼
  // console.log('=== Debug stack ===\n' + stackLines.join('\n') + '\n======');

  // 依序掃, 若有符合 /xxx.js:行:列/ 就嘗試 parse
  // 通常第一個不是 logger.js/node_modules/internal 的, 就很可能是 main.js
  for (const line of stackLines) {
    // 過濾掉 logger.js、node_modules、internal, 但其他都嘗試解析
    if (
      line.includes('logger.js') ||
      line.includes('node_modules') ||
      line.includes('internal')
    ) {
      continue;
    }

    // 解析 "at someFunc (xxxx/main.js:10:20)" 格式
    const match = line.match(/at (?:.+\()?(.*?):(\d+):(\d+)\)?/);
    if (match) {
      const filePath = match[1];
      const lineNumber = match[2];
      // 只要抓到就復原 limit, 回傳資訊
      Error.stackTraceLimit = originalLimit;
      return `${path.basename(filePath)}:${lineNumber}`;
    }
  }

  // 如果掃完都沒找到, 就回 unknown
  Error.stackTraceLimit = originalLimit;
  return 'unknown';
}

const customFormat = format.printf(info => {
  const { timestamp, level, message } = info;
  // 取出 splat 參數 => logger.info("xxx", "yyy", 123) 之類
  const splat = info[Symbol.for('splat')];
  let extra = '';
  if (Array.isArray(splat) && splat.length > 0) {
    // 依型態轉成字串
    extra = splat
      .map(item => (typeof item === 'object' ? JSON.stringify(item) : item))
      .join(' ');
  }

  // 抓 caller info
  const callerInfo = getCallerInfo();
  return `[${timestamp}] [${level.toUpperCase()}] [${callerInfo}] ${message}${
    extra ? ' ' + extra : ''
  }`;
});

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.splat(),
    customFormat
  ),
  transports: [new transports.Console()]
  // transports: [new transports.Console(),new transports.File({ filename: 'app.log', encoding: 'utf8' })]
});

module.exports = logger;
