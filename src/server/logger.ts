import pino from 'pino';
import type { AppConfig } from './config';

/**
 * Logging structure : en production, du JSON une ligne par evenement, exploitable
 * par n'importe quel collecteur. En developpement, une sortie lisible.
 */
export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL' | 'isProduction'>) {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'bacc-server' },
    redact: {
      // Un token de reconnexion ne doit jamais atterrir dans les logs.
      paths: ['token', '*.token', 'req.headers.authorization'],
      censor: '[redacted]',
    },
    transport: config.isProduction
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
  });
}

export type Logger = ReturnType<typeof createLogger>;
