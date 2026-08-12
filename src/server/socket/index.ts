import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { SOCKET_PATH } from '../../shared';
import type { GameContext } from '../context';
import type { StoreBundle } from '../store';
import { registerHandlers } from './handlers';
import type { GameServer, GameSocket } from './types';
import type { HandlerEnv } from './guard';

export function createSocketServer(
  httpServer: HttpServer,
  ctx: GameContext,
  stores: StoreBundle,
): { io: GameServer; env: HandlerEnv } {
  const io: GameServer = new Server(httpServer, {
    path: SOCKET_PATH,
    // En meme origine, aucune autorisation CORS n'est requise. On ne la configure
    // que si un front heberge ailleurs est explicitement declare.
    ...(ctx.config.crossOrigin
      ? { cors: { origin: ctx.config.corsOrigins, credentials: true } }
      : {}),
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
