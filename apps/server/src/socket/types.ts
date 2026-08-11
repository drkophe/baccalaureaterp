import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { ServerToClientEvents, SocketData } from '@bacc/shared';

/**
 * Les evenements entrants sont volontairement types `unknown` : tout ce qui
 * arrive du reseau est une donnee non fiable, validee par Zod dans le garde de
 * chaque handler. Le contrat fort (`ClientToServerEvents`) reste celui du client.
 */
export type IncomingEvents = Record<string, (...args: unknown[]) => void>;

export type GameServer = Server<IncomingEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
export type GameSocket = Socket<IncomingEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
