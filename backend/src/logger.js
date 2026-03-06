const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error', maxsize: 5*1024*1024, maxFiles: 5 }),
    new transports.File({ filename: path.join(logsDir, 'combined.log'), maxsize: 10*1024*1024, maxFiles: 5 })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  // Pretty, structured console output that stringifies object messages
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.timestamp(),
      format.printf((info) => {
        const { timestamp, level } = info;
        const msg = typeof info.message === 'object' ? JSON.stringify(info.message) : String(info.message);
        // Include other enumerable props (except built-ins) as JSON metadata
        const { message, level: _l, timestamp: _t, ...rest } = info;
        const metaKeys = Object.keys(rest).filter(k => rest[k] !== undefined);
        const meta = metaKeys.length ? ` ${JSON.stringify(rest)}` : '';
        return `${timestamp} ${level}: ${msg}${meta}`;
      })
    )
  }));
}

module.exports = { logger, logsDir };
