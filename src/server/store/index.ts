import { Redis } from 'ioredis';
import type { AppConfig } from '../config';
import type { Logger } from '../logger';
import { MemorySessionStore } from './memoryStore';
import { RedisSessionStore } from './redisStore';
import type { SessionStore } from './types';

export type { SessionStore, TimerSet } from './types';
export { MemorySessionStore } from './memoryStore';
export { RedisSessionStore } from './redisStore';

export interface StoreBundle {
  store: SessionStore;
  /** Clients dedies au pub/sub de l'adapter Socket.io (null sans Redis). */
  pubClient: Redis | null;
  subClient: Redis | null;
  /** Vrai si l'etat est partage entre instances. */
  distributed: boolean;
  close: () => Promise<void>;
}

function createRedisClient(url: string, role: string, logger: Logger): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });

  client.on('error', (error: Error) => logger.error({ err: error, role }, 'Erreur client Redis'));
  client.on('reconnecting', () => logger.warn({ role }, 'Reconnexion Redis en cours'));
  return client;
}

/**
 * Choisit ou vit l'etat des parties.
 *
 * Par defaut : la memoire du process. C'est suffisant pour une instance unique,
 * ce qui couvre le cas d'usage reel du jeu, et cela evite d'imposer un service
 * Redis a l'installation.
 *
 * Si `REDIS_URL` est renseignee, l'etat passe dans Redis et l'adapter Socket.io
 * relaie les evenements : plusieurs instances peuvent alors servir la meme partie.
 * Redis injoignable au demarrage = repli sur la memoire plutot qu'un crash.
 */
export async function createStore(config: AppConfig, logger: Logger): Promise<StoreBundle> {
  const memoryBundle = (): StoreBundle => {
    const store = new MemorySessionStore();
    return {
      store,
      pubClient: null,
      subClient: null,
      distributed: false,
      close: () => store.close(),
    };
  };

  if (!config.REDIS_URL) {
    logger.info('Etat des parties en memoire (instance unique)');
    return memoryBundle();
  }

  const main = createRedisClient(config.REDIS_URL, 'main', logger);
  try {
    await main.connect();
    await main.ping();
  } catch (error) {
    await main.quit().catch(() => undefined);
    logger.warn({ err: error }, 'Redis injoignable : repli sur la memoire (instance unique)');
    return memoryBundle();
  }

  const pubClient = createRedisClient(config.REDIS_URL, 'pub', logger);
  const subClient = createRedisClient(config.REDIS_URL, 'sub', logger);
  await Promise.all([pubClient.connect(), subClient.connect()]);

  const store = new RedisSessionStore(main, config.REDIS_PREFIX);
  logger.info({ prefix: config.REDIS_PREFIX }, 'Etat des parties dans Redis (multi-instance)');

  return {
    store,
    pubClient,
    subClient,
    distributed: true,
    close: async () => {
      await store.close();
      await pubClient.quit().catch(() => undefined);
      await subClient.quit().catch(() => undefined);
    },
  };
}
