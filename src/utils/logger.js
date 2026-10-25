import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'BOT_TOKEN',
      'botToken',
      'token',
      'provider_token',
      'authorization',
      'headers.authorization',
      '*.BOT_TOKEN',
      '*.botToken',
      '*.token'
    ],
    censor: '[REDACTED]'
  },
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname'
        }
      }
    : undefined
});

export default logger;
