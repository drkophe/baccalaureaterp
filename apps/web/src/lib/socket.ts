import { io, type Socket } from 'socket.io-client';
import { SOCKET_PATH, type ClientToServerEvents, type ServerToClientEvents } from '@bacc/shared';

export type GameClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * URL du serveur temps reel. Configurable a la construction pour pouvoir
 * heberger le front et le back sur deux domaines differents.
 */
export function serverUrl(): string {
  return process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';
}

export function createSocket(): GameClientSocket {
  return io(serverUrl(), {
    path: SOCKET_PATH,
    transports: ['websocket', 'polling'],
    // La reconnexion automatique est le coeur de la resilience cote client :
    // coupure de wifi, passage en 4G, mise en veille du telephone.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
    timeout: 10_000,
  });
}

export interface CreateSessionResponse {
  code: string;
  playerId: string;
  token: string;
}

/** Cree une partie via l'API HTTP : renvoie le code a partager et l'identite de l'hote. */
export async function createSessionRequest(nickname: string): Promise<CreateSessionResponse> {
  const response = await fetch(`${serverUrl()}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });

  const body = (await response.json().catch(() => null)) as
    (CreateSessionResponse & { message?: string }) | null;

  if (!response.ok || !body) {
    throw new Error(body?.message ?? 'Impossible de creer la partie pour le moment.');
  }
  return body;
}
