const winston = require('winston')
const path = require('path')
const Transport = require('winston-transport')
const EventEmitter = require('events')

class LogEmitter extends EventEmitter {}
const logEmitter = new LogEmitter()

class SocketTransport extends Transport {
  constructor(opts) {
    super(opts)
  }
  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info)
      // The symbol contains the formatted string
      const msg = info[Symbol.for('message')] || info.message
      logEmitter.emit('log', msg)
    })
    callback()
  }
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
      return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}`
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/agent.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
    new SocketTransport(),
  ],
})

logger.logEmitter = logEmitter

module.exports = logger
