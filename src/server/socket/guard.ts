import type { ZodType } from 'zod';
import { GameError, isGameError, messageForCode, type Session } from '../../shared';
import type { GameContext } from '../context';
import { broadcastState, emitTransitionEffects, snapshot, syncDeadline } from './broadcast';
import type { GameServer, GameSocket } from './types';

export interface HandlerEnv extends GameContext {
  io: GameServer;
}

export interface RateLimitRule {
  points: number;
  windowSeconds: number;
}

export interface GuardOptions<TPayload> {
  /** Schema Zod applique au premier argument recu. Absent = evenement sans payload. */
  schema?: ZodType<TPayload>;
  rateLimit?: RateLimitRule;
  /** Exige un socket deja rattache a une session (defaut : oui). */
  requireAuth?: boolean;
}

export interface HandlerArgs<TPayload> {
  socket: GameSocket;
  payload: TPayload;
  code: string;
  playerId: string;
}

/**
 * Enveloppe commune a tous les handlers socket. Elle garantit, pour chaque
 * evenement recu :
 *   1. qu'une entree malformee ne fait jamais tomber le process ;
 *   2. que le payload est valide et assaini avant d'atteindre le moteur ;
 *   3. que l'action est comptabilisee par le rate limiter ;
 *   4. que le socket est bien rattache a une session et a un joueur ;
 *   5. qu'une erreur metier repart au client sous forme d'evenement `error`,
 *      et qu'une erreur inattendue est loguee sans fuiter de detail interne.
 */
export function guard<TPayload = void>(
  env: HandlerEnv,
  socket: GameSocket,
  event: string,
  options: GuardOptions<TPayload>,
  handler: (args: HandlerArgs<TPayload>) => Promise<void> | void,
): (...args: unknown[]) => void {
  const requireAuth = options.requireAuth !== false;

  return (...args: unknown[]) => {
    void (async () => {
      try {
        if (options.rateLimit) {
          await enforceRateLimit(env, socket, event, options.rateLimit);
        }

        const code = socket.data.sessionCode;
        const playerId = socket.data.playerId;
        if (requireAuth && (!code || !playerId)) {
          throw new GameError('NOT_AUTHENTICATED');
        }

        let payload = undefined as TPayload;
        if (options.schema) {
          const parsed = options.schema.safeParse(args[0]);
          if (!parsed.success) {
            throw new GameError('INVALID_PAYLOAD', parsed.error.issues[0]?.message);
          }
          payload = parsed.data;
        }

        await handler({
          socket,
          payload,
          code: code ?? '',
          playerId: playerId ?? '',
        });
      } catch (error) {
        replyError(env, socket, event, error);
      }
    })();
  };
}

export async function enforceRateLimit(
  env: HandlerEnv,
  socket: GameSocket,
  event: string,
  rule: RateLimitRule,
): Promise<void> {
  if (env.config.DISABLE_RATE_LIMIT) return;
  const identity = socket.data.playerId ?? socket.id;
  const allowed = await env.store.consumeRateLimit(
    `ws:${event}:${identity}`,
    rule.points,
    rule.windowSeconds,
  );
  if (!allowed) throw new GameError('RATE_LIMITED');
}

/** Traduit toute exception en evenement `error` cote client, sans jamais crasher. */
export function replyError(
  env: HandlerEnv,
  socket: GameSocket,
  event: string,
  error: unknown,
): void {
  if (isGameError(error)) {
    env.logger.debug({ event, code: error.code, socketId: socket.id }, 'Action refusee');
    socket.emit('error', {
      code: error.code,
      message: messageForCode(error.code),
      origin: event,
    });
    return;
  }

  env.logger.error({ err: error, event, socketId: socket.id }, 'Handler socket en echec');
  socket.emit('error', {
    code: 'INTERNAL_ERROR',
    message: messageForCode('INTERNAL_ERROR'),
    origin: event,
  });
}

/**
 * Mutation standard : verrou, application, sauvegarde, puis diffusion de l'etat
 * et des effets d'animation. Les handlers n'ont pas a se soucier de cette
 * mecanique — c'est ce qui garantit que rien n'est oublie (echeance non
 * replanifiee, etat non diffuse) d'un handler a l'autre.
 */
export async function mutateAndBroadcast(
  env: HandlerEnv,
  code: string,
  mutate: (session: Session) => void | Promise<void>,
): Promise<Session> {
  let before: ReturnType<typeof snapshot> | null = null;

  const session = await env.store.withLock(code, async (current) => {
    before = snapshot(current);
    await mutate(current);
    return current;
  });

  await syncDeadline(env, session);
  if (before) emitTransitionEffects(env.io, session, before);
  await broadcastState(env.io, session);
  return session;
}
