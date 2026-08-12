import { createServer } from 'node:http';
import type { Request, Response } from 'express';
import next from 'next';
import { loadConfig } from './src/server/config';
import { createApiRouter } from './src/server/api';
import { engineDeps, type GameContext } from './src/server/context';
import { createLogger } from './src/server/logger';
import { Scheduler } from './src/server/scheduler';
import { createSocketServer } from './src/server/socket';
import { createStore } from './src/server/store';

/**
 * Point d'entree unique de l'application.
 *
 * Le front Next.js et le serveur temps reel Socket.io tournent dans le MEME
 * processus, sur le MEME port. C'est ce qui rend le deploiement trivial :
 * un seul service a heberger, aucune URL a faire pointer d'un service vers
 * l'autre, et aucune configuration CORS puisque tout est en meme origine.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  // Un crash silencieux est pire qu'une erreur loguee.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Promesse rejetee non geree');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Exception non capturee, arret du process');
    process.exit(1);
  });

  const stores = await createStore(config, logger);
  const ctx: GameContext = { config, logger, store: stores.store, deps: engineDeps };

  const nextApp = next({ dev: !config.isProduction, hostname: config.HOST, port: config.PORT });
  await nextApp.prepare();
  const handleNextRequest = nextApp.getRequestHandler();

  // L'API du jeu passe en premier, tout le reste part au routeur Next.
  const app = createApiRouter(ctx);
  app.use((req: Request, res: Response) => {
    void handleNextRequest(req, res);
  });

  const httpServer = createServer(app);
  const { io } = createSocketServer(httpServer, ctx, stores);

  const scheduler = new Scheduler({ ...ctx, io });
  scheduler.start();

  await new Promise<void>((resolve) => {
    httpServer.listen(config.PORT, config.HOST, resolve);
  });

  logger.info(
    {
      url: `http://${config.HOST}:${config.PORT}`,
      env: config.NODE_ENV,
      store: stores.distributed ? 'redis' : 'memoire',
    },
    'Baccalaureat pret',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Arret demande');
    scheduler.stop();

    const forced = setTimeout(() => {
      logger.warn('Arret force apres delai');
      process.exit(1);
    }, 10_000);
    forced.unref();

    try {
      await io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await nextApp.close();
      await stores.close();
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
