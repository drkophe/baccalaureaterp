import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import pino from 'pino';
import {
  SOCKET_PATH,
  type ClientSession,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
} from '@bacc/shared';
import type { AppConfig } from '../config.js';
import { engineDeps, type GameContext } from '../game/context.js';
import { createApp } from '../http/app.js';
import { Scheduler } from '../scheduler.js';
import { createSocketServer } from '../socket/index.js';
import { MemorySessionStore } from '../store/memoryStore.js';

export type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export interface TestServer {
  url: string;
  store: MemorySessionStore;
  close: () => Promise<void>;
}

const testConfig = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  CORS_ORIGINS: 'http://localhost:3000',
  corsOrigins: ['http://localhost:3000'],
  REDIS_URL: 'redis://127.0.0.1:6379',
  REDIS_PREFIX: 'test',
  ALLOW_MEMORY_STORE: true,
  LOG_LEVEL: 'silent',
  TRUST_PROXY: 0,
  DISABLE_RATE_LIMIT: true,
  isProduction: false,
} as unknown as AppConfig;

/** Serveur complet (HTTP + socket + ordonnanceur) sur un port ephemere, store memoire. */
export async function startTestServer(): Promise<TestServer> {
  const store = new MemorySessionStore();
  const logger = pino({ level: 'silent' });
  const ctx: GameContext = { config: testConfig, logger, store, deps: engineDeps };

  const app = createApp(ctx);
  const httpServer: HttpServer = createServer(app);
  const { io, env } = createSocketServer(httpServer, ctx, {
    store,
    pubClient: null,
    subClient: null,
    distributed: false,
  });

  const scheduler = new Scheduler(env);
  scheduler.start();

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    store,
    close: async () => {
      scheduler.stop();
      await io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await store.close();
    },
  };
}

export function connectClient(url: string): TestClient {
  return createClient(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  }) as TestClient;
}

export interface HostCredentials {
  code: string;
  playerId: string;
  token: string;
}

/**
 * `POST /api/sessions` cree la partie ET inscrit l'hote : il rejoint ensuite le
 * socket avec les identifiants recus, pas comme un nouveau joueur.
 */
export async function createSessionOverHttp(
  url: string,
  nickname: string,
): Promise<HostCredentials> {
  const response = await fetch(`${url}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  if (!response.ok) throw new Error(`Creation refusee: ${response.status}`);
  return (await response.json()) as HostCredentials;
}

export function join(
  client: TestClient,
  payload: { code: string; nickname: string; playerId?: string; token?: string },
): Promise<JoinResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('join: pas de reponse')), 5_000);
    client.emit('session:join', payload, (result: JoinResult) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

/** Attend le premier etat satisfaisant le predicat, en collectant les etats recus. */
export function waitForState(
  client: TestClient,
  predicate: (session: ClientSession) => boolean,
  timeoutMs = 15_000,
): Promise<ClientSession> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('session:state', listener);
      reject(new Error('waitForState: delai depasse'));
    }, timeoutMs);

    const listener = (session: ClientSession): void => {
      if (!predicate(session)) return;
      clearTimeout(timer);
      client.off('session:state', listener);
      resolve(session);
    };

    client.on('session:state', listener);
  });
}

export function waitForEvent<K extends keyof ServerToClientEvents>(
  client: TestClient,
  event: K,
  timeoutMs = 15_000,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`waitForEvent(${String(event)}): delai depasse`)),
      timeoutMs,
    );
    client.once(
      event as never,
      ((payload: unknown) => {
        clearTimeout(timer);
        resolve(payload as Parameters<ServerToClientEvents[K]>[0]);
      }) as never,
    );
  });
}

export function closeClients(...clients: TestClient[]): void {
  for (const client of clients) {
    client.removeAllListeners();
    client.close();
  }
}
