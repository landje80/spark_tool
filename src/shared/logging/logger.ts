import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'spark-tool' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.token',
      '*.password',
      '*.secret',
      '*.apiKey',
      '*.client_secret',
    ],
    censor: '[REDACTED]',
  },
});
