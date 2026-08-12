import { io, type Socket } from 'socket.io-client';
import { SOCKET_PATH, type ClientToServerEvents, type ServerToClientEvents } from '@/shared';

export type GameClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Le serveur temps reel est servi par le meme processus que ces pages : la
 * connexion se fait donc en meme origine, sans aucune URL a configurer.
 *
 * `NEXT_PUBLIC_SERVER_URL` n'est utile que dans le cas particulier ou le front
 * serait heberge separement du serveur.
 */
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? '';

export function createSocket(): GameClientSocket {
  return io(SERVER_URL, {
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

/** Cree une partie : renvoie le code a partager et l'identite de l'hote. */
export async function createSessionRequest(nickname: string): Promise<CreateSessionResponse> {
  const response = await fetch(`${SERVER_URL}/api/sessions`, {
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
