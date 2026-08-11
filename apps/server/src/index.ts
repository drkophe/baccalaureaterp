import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { engineDeps, type GameContext } from './game/context.js';
import { createApp } from './http/app.js';
import { createLogger } from './logger.js';
import { Scheduler } from './scheduler.js';
import { createSocketServer } from './socket/index.js';
import { createStore } from './store/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  // Un crash silencieux est pire qu'une erreur loguee : on trace tout ce qui
  // remonte jusqu'a la boucle d'evenements avant de decider quoi faire.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Promesse rejetee non geree');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Exception non capturee, arret du process');
    process.exit(1);
  });

  const stores = await createStore(config, logger);
  const ctx: GameContext = { config, logger, store: stores.store, deps: engineDeps };

  const app = createApp(ctx);
  const httpServer = createServer(app);
  const { io, env } = createSocketServer(httpServer, ctx, stores);

  const scheduler = new Scheduler(env);
  scheduler.start();

  await new Promise<void>((resolve) => {
    httpServer.listen(config.PORT, config.HOST, resolve);
  });

  logger.info(
    {
      port: config.PORT,
      env: config.NODE_ENV,
      origins: config.corsOrigins,
      distributed: stores.distributed,
    },
    'Serveur Baccalaureat pret',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Arret demande');
    scheduler.stop();

    const timeout = setTimeout(() => {
      logger.warn('Arret force apres delai');
      process.exit(1);
    }, 10_000);
    timeout.unref();

    try {
      await io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await stores.store.close();
      await stores.pubClient?.quit().catch(() => undefined);
      await stores.subClient?.quit().catch(() => undefined);
      logger.info('Arret propre termine');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Arret en echec');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // Pas de logger disponible a coup sur a ce stade : on ecrit sur stderr.
  console.error('Demarrage impossible', error);
  process.exit(1);
});
