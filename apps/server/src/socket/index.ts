import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { SOCKET_PATH } from '@bacc/shared';
import type { GameContext } from '../game/context.js';
import type { StoreBundle } from '../store/index.js';
import { registerHandlers } from './handlers.js';
import type { GameServer, GameSocket } from './types.js';
import type { HandlerEnv } from './guard.js';

export function createSocketServer(
  httpServer: HttpServer,
  ctx: GameContext,
  stores: StoreBundle,
): { io: GameServer; env: HandlerEnv } {
  const io: GameServer = new Server(httpServer, {
    path: SOCKET_PATH,
    cors: {
      origin: ctx.config.corsOrigins,
      credentials: true,
    },
    // Un client mobile qui passe en tunnel a besoin d'une fenetre confortable
    // avant d'etre considere comme parti.
    pingInterval: 20_000,
    pingTimeout: 25_000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 60_000,
      skipMiddlewares: false,
    },
    maxHttpBufferSize: 32_000,
  });

  if (stores.pubClient && stores.subClient) {
    // Sans cet adapter, deux joueurs servis par deux instances differentes ne
    // recevraient pas les evenements de l'autre.
    io.adapter(createAdapter(stores.pubClient, stores.subClient));
    ctx.logger.info('Adapter Redis Socket.io actif');
  } else {
    ctx.logger.warn('Adapter Socket.io en memoire : une seule instance supportee');
  }

  const env: HandlerEnv = { ...ctx, io };

  io.on('connection', (socket: GameSocket) => {
    ctx.logger.debug({ socketId: socket.id }, 'Socket connecte');
    try {
      registerHandlers(env, socket);
    } catch (error) {
      ctx.logger.error({ err: error, socketId: socket.id }, 'Enregistrement des handlers en echec');
      socket.disconnect(true);
    }
  });

  io.engine.on('connection_error', (error: unknown) => {
    ctx.logger.warn({ err: error }, 'Connexion socket refusee');
  });

  return { io, env };
}
