import pino from 'pino';
import type { AppConfig } from './config';

/**
 * `pino-pretty` n'est qu'un confort de developpement, et n'est pas installe dans
 * une image de production. On verifie sa presence plutot que de deduire de
 * NODE_ENV qu'il est la : sinon un `npm start` sans NODE_ENV, apres une
 * installation sans devDependencies, ferait echouer le demarrage sur un detail
 * de mise en forme des logs.
 */
function prettyPrinterAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Logging structure : en production, du JSON une ligne par evenement, exploitable
 * par n'importe quel collecteur. En developpement, une sortie lisible.
 */
export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL' | 'isProduction'>) {
  const pretty = !config.isProduction && prettyPrinterAvailable();

  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'bacc-server' },
    redact: {
      // Un token de reconnexion ne doit jamais atterrir dans les logs.
      paths: ['token', '*.token', 'req.headers.authorization'],
      censor: '[redacted]',
    },
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        }
      : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
