import { Redis } from 'ioredis';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { MemorySessionStore } from './memoryStore.js';
import { RedisSessionStore } from './redisStore.js';
import type { SessionStore } from './types.js';

export type { SessionStore, TimerSet } from './types.js';
export { MemorySessionStore } from './memoryStore.js';
export { RedisSessionStore } from './redisStore.js';

export interface StoreBundle {
  store: SessionStore;
  /** Clients dedies au pub/sub de l'adapter Socket.io (null en mode memoire). */
  pubClient: Redis | null;
  subClient: Redis | null;
  /** Vrai si Redis est reellement utilise (donc multi-instance possible). */
  distributed: boolean;
}

export function createRedisClient(url: string, role: string, logger: Logger): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });

  client.on('error', (error: Error) => {
    logger.error({ err: error, role }, 'Erreur client Redis');
  });
  client.on('reconnecting', () => {
    logger.warn({ role }, 'Reconnexion Redis en cours');
  });

  return client;
}

/**
 * Choisit le store : Redis par defaut (obligatoire en production), repli memoire
 * uniquement si `ALLOW_MEMORY_STORE=true` et que Redis ne repond pas.
 */
export async function createStore(config: AppConfig, logger: Logger): Promise<StoreBundle> {
  const main = createRedisClient(config.REDIS_URL, 'main', logger);

  try {
    await main.connect();
    await main.ping();
  } catch (error) {
    await main.quit().catch(() => undefined);

    if (!config.ALLOW_MEMORY_STORE) {
      logger.error({ err: error }, 'Redis injoignable et repli memoire desactive');
      throw error;
    }

    logger.warn(
      { err: error },
      'Redis injoignable : repli sur le store memoire (mono-instance, developpement uniquement)',
    );
    return {
      store: new MemorySessionStore(),
      pubClient: null,
      subClient: null,
      distributed: false,
    };
  }

  const pubClient = createRedisClient(config.REDIS_URL, 'pub', logger);
  const subClient = createRedisClient(config.REDIS_URL, 'sub', logger);
  await Promise.all([pubClient.connect(), subClient.connect()]);

  logger.info({ prefix: config.REDIS_PREFIX }, 'Store Redis pret (multi-instance)');
  return {
    store: new RedisSessionStore(main, config.REDIS_PREFIX),
    pubClient,
    subClient,
    distributed: true,
  };
}
