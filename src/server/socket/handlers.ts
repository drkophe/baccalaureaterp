import {
  addCategory,
  addPlayer,
  answerSchema,
  backToLobby,
  abortToLobby,
  castVote,
  categoryAddSchema,
  categoryRemoveSchema,
  categoryReorderSchema,
  countFilledAnswers,
  currentCategory,
  GameError,
  isGameError,
  joinPayloadSchema,
  markConnected,
  markDisconnected,
  maybeCloseVoting,
  messageForCode,
  nextRound,
  RATE_LIMITS,
  readySchema,
  redactSession,
  removeCategory,
  removePlayer,
  reorderCategories,
  requireRound,
  roomForSession,
  setAnswer,
  setReady,
  settingsUpdateSchema,
  startGame,
  stopRound,
  TIMINGS,
  updateSettings,
  voteSchema,
  type JoinResult,
  type Session,
} from '../../shared';
import { generateId, generateToken, hashToken, verifyToken } from '../identity';
import { broadcastState } from './broadcast';
import { enforceRateLimit, guard, mutateAndBroadcast, type HandlerEnv } from './guard';
import type { GameSocket } from './types';

/** Branche l'ensemble des evenements d'un socket fraichement connecte. */
export function registerHandlers(env: HandlerEnv, socket: GameSocket): void {
  socket.data.sessionCode = null;
  socket.data.playerId = null;

  socket.on('session:join', createJoinHandler(env, socket));

  socket.on(
    'session:leave',
    guard(env, socket, 'session:leave', { rateLimit: RATE_LIMITS.GENERIC_ACTION }, async (args) => {
      await leaveSession(env, args.socket, args.code, args.playerId);
    }),
  );

  socket.on(
    'player:ready',
    guard(
      env,
      socket,
      'player:ready',
      { schema: readySchema, rateLimit: RATE_LIMITS.GENERIC_ACTION },
      async ({ code, playerId, payload }) => {
        await mutateAndBroadcast(env, code, (session) => {
          setReady(session, playerId, payload.ready, env.deps);
        });
      },
    ),
  );

  socket.on(
    'settings:update',
    guard(
      env,
      socket,
      'settings:update',
      { schema: settingsUpdateSchema, rateLimit: RATE_LIMITS.SETTINGS_UPDATE },
      async ({ code, playerId, payload }) => {
        await mutateAndBroadcast(env, code, (session) => {
          updateSettings(session, playerId, payload, env.deps);
        });
      },
    ),
  );

  socket.on(
    'category:add',
    guard(
      env,
      socket,
      'category:add',
      { schema: categoryAddSchema, rateLimit: RATE_LIMITS.CATEGORY_MUTATION },
      async ({ code, playerId, payload }) => {
        await mutateAndBroadcast(env, code, (session) => {
          addCategory(session, playerId, payload.label, env.deps);
        });
      },
    ),
  );

  socket.on(
    'category:remove',
    guard(
      env,
      socket,
      'category:remove',
      { schema: categoryRemoveSchema, rateLimit: RATE_LIMITS.CATEGORY_MUTATION },
      async ({ code, playerId, payload }) => {
        await mutateAndBroadcast(env, code, (session) => {
          removeCategory(session, playerId, payload.categoryId, env.deps);
        });
      },
    ),
  );

  socket.on(
    'category:reorder',
    guard(
      env,
      socket,
      'category:reorder',
      { schema: categoryReorderSchema, rateLimit: RATE_LIMITS.CATEGORY_MUTATION },
      async ({ code, playerId, payload }) => {
        await mutateAndBroadcast(env, code, (session) => {
          reorderCategories(session, playerId, payload.categoryIds, env.deps);
        });
      },
    ),
  );

  socket.on(
    'game:start',
    guard(
      env,
      socket,
      'game:start',
      { rateLimit: RATE_LIMITS.GENERIC_ACTION },
      async ({ code, playerId }) => {
        await mutateAndBroadcast(env, code, (session) => {
          startGame(session, playerId, env.deps);
        });
      },
    ),
  );

  socket.on(
    'game:abort',
    guard(
      env,
      socket,
      'game:abort',
      { rateLimit: RATE_LIMITS.GENERIC_ACTION },
      async ({ code, playerId }) => {
        await mutateAndBroadcast(env, code, (session) => {
          if (session.hostId !== playerId) throw new GameError('NOT_HOST');
          abortToLobby(session, env.deps);
        });
      },
    ),
  );

  socket.on(
    'game:lobby',
    guard(
      env,
      socket,
      'game:lobby',
      { rateLimit: RATE_LIMITS.GENERIC_ACTION },
      async ({ code, playerId }) => {
        await mutateAndBroadcast(env, code, (session) => {
          backToLobby(session, playerId, env.deps);
        });
      },
    ),
  );

  socket.on(
    'round:next',
    guard(
      env,
      socket,
      'round:next',
      { rateLimit: RATE_LIMITS.GENERIC_ACTION },
      async ({ code, playerId }) => {
        await mutateAndBroadcast(env, code, (session) => {
          nextRound(session, playerId, env.deps);
        });
      },
    ),
  );

  socket.on(
    'round:stop',
    guard(
      env,
      socket,
      'round:stop',
      { rateLimit: RATE_LIMITS.GENERIC_ACTION },
      async ({ code, playerId }) => {
        await mutateAndBroadcast(env, code, (session) => {
          stopRound(session, 'player', playerId, env.deps);
        });
      },
    ),
  );

  socket.on(
    'round:answer',
    guard(
      env,
      socket,
      'round:answer',
      { schema: answerSchema, rateLimit: RATE_LIMITS.ANSWER_UPDATE },
      async ({ code, playerId, payload }) => {
        // Cas particulier : la frappe est frequente et privee. On ne rediffuse pas
        // tout l'etat, seulement le nombre de champs remplis par joueur.
        const session = await env.store.withLock(code, (current) => {
          setAnswer(current, playerId, payload.categoryId, payload.value, env.deps);
          return current;
        });

        const round = session.round;
        if (!round) return;
        env.io
          .to(roomForSession(code))
          .emit('round:progress', { filledCounts: countFilledAnswers(round) });
      },
    ),
  );

  socket.on(
    'vote:cast',
    guard(
      env,
      socket,
      'vote:cast',
      { schema: voteSchema, rateLimit: RATE_LIMITS.VOTE },
      async ({ code, playerId, payload }) => {
        await mutateAndBroadcast(env, code, (session) => {
          const round = requireRound(session);
          // Le vote porte toujours sur la categorie affichee : un client en retard
          // ne doit pas pouvoir noter la categorie suivante.
          if (currentCategory(round)?.id !== payload.categoryId) {
            throw new GameError('VOTE_NOT_OPEN');
          }
          castVote(session, playerId, payload.targetPlayerId, payload.points, env.deps);
        });
      },
    ),
  );

  socket.on('disconnect', (reason: unknown) => {
    void handleDisconnect(env, socket, String(reason));
  });
}

/* -------------------------------------------------------------------------- */
/*                                    Join                                     */
/* -------------------------------------------------------------------------- */

type Ack = (result: JoinResult) => void;

function createJoinHandler(env: HandlerEnv, socket: GameSocket) {
  return (...args: unknown[]) => {
    const ack = args.find((arg): arg is Ack => typeof arg === 'function');

    void (async () => {
      try {
        await enforceRateLimit(env, socket, 'session:join', RATE_LIMITS.JOIN_SESSION);

        const parsed = joinPayloadSchema.safeParse(args[0]);
        if (!parsed.success) {
          throw new GameError('INVALID_PAYLOAD', parsed.error.issues[0]?.message);
        }
        const payload = parsed.data;

        let issuedToken = '';
        let joinedPlayerId = '';
        let reconnected = false;

        const session = await env.store.withLock(payload.code, (current) => {
          const existing = payload.playerId
            ? current.players.find((player) => player.id === payload.playerId)
            : undefined;

          if (existing) {
            // Reconnexion : le token prouve qu'il s'agit bien du meme joueur.
            if (!payload.token || !verifyToken(payload.token, existing.tokenHash)) {
              throw new GameError('NOT_AUTHENTICATED');
            }
            markConnected(current, existing.id, env.deps);
            joinedPlayerId = existing.id;
            issuedToken = payload.token;
            reconnected = true;
            return current;
          }

          const token = generateToken();
          const player = addPlayer(
            current,
            { id: generateId(), nickname: payload.nickname, tokenHash: hashToken(token) },
            env.deps,
          );
          joinedPlayerId = player.id;
          issuedToken = token;
          return current;
        });

        socket.data.sessionCode = session.code;
        socket.data.playerId = joinedPlayerId;
        await socket.join(roomForSession(session.code));

        // La fenetre de grace n'a plus lieu d'etre : le joueur est revenu.
        if (reconnected) await env.store.sweeps.cancel(session.code);

        const nickname =
          session.players.find((player) => player.id === joinedPlayerId)?.nickname ??
          payload.nickname;

        ack?.({
          ok: true,
          playerId: joinedPlayerId,
          token: issuedToken,
          session: redactSession(session, joinedPlayerId, Date.now()),
        });

        const others = socket.to(roomForSession(session.code));
        if (reconnected) {
          others.emit('notice', { kind: 'info', message: `${nickname} est de retour` });
        } else {
          others.emit('player:joined', { playerId: joinedPlayerId, nickname });
        }

        await broadcastState(env.io, session);

        env.logger.info(
          { code: session.code, playerId: joinedPlayerId, reconnected },
          reconnected ? 'Joueur reconnecte' : 'Joueur rejoint',
        );
      } catch (error) {
        const code = isGameError(error) ? error.code : 'INTERNAL_ERROR';
        if (!isGameError(error)) {
          env.logger.error({ err: error, event: 'session:join' }, 'Join en echec');
        }
        ack?.({ ok: false, code, message: messageForCode(code) });
      }
    })();
  };
}

/* -------------------------------------------------------------------------- */
/*                          Depart et deconnexion                              */
/* -------------------------------------------------------------------------- */

async function leaveSession(
  env: HandlerEnv,
  socket: GameSocket,
  code: string,
  playerId: string,
): Promise<void> {
  const session = await env.store.withLock(code, (current) => {
    const player = current.players.find((item) => item.id === playerId);
    if (player) {
      env.io.to(roomForSession(code)).emit('player:left', { playerId, nickname: player.nickname });
    }
    removePlayer(current, playerId, env.deps);
    maybeCloseVoting(current, env.deps);
    return current;
  });

  await socket.leave(roomForSession(code));
  socket.data.sessionCode = null;
  socket.data.playerId = null;

  if (await deleteIfEmpty(env, session)) return;
  await broadcastState(env.io, session);
}

async function handleDisconnect(
  env: HandlerEnv,
  socket: GameSocket,
  reason: string,
): Promise<void> {
  const code = socket.data.sessionCode;
  const playerId = socket.data.playerId;
  if (!code || !playerId) return;

  try {
    // Un joueur peut avoir plusieurs onglets ouverts : il n'est reellement
    // deconnecte que lorsque son dernier socket est parti.
    const remaining = await env.io.in(roomForSession(code)).fetchSockets();
    if (remaining.some((other) => other.data.playerId === playerId)) return;

    await mutateAndBroadcast(env, code, (session) => {
      markDisconnected(session, playerId, env.deps);
      maybeCloseVoting(session, env.deps);
    });

    // On laisse au joueur sa fenetre de reconnexion avant de le retirer.
    await env.store.sweeps.schedule(code, Date.now() + TIMINGS.DISCONNECT_GRACE_MS + 1_000);

    env.logger.debug({ code, playerId, reason }, 'Joueur deconnecte');
  } catch (error) {
    if (isGameError(error) && error.code === 'SESSION_NOT_FOUND') return;
    env.logger.error({ err: error, code, playerId }, 'Deconnexion mal geree');
  }
}

/** Supprime une session vide plutot que d'attendre son TTL. */
export async function deleteIfEmpty(env: HandlerEnv, session: Session): Promise<boolean> {
  if (session.players.length > 0) return false;
  await env.store.delete(session.code);
  env.logger.info({ code: session.code }, 'Session vide supprimee');
  return true;
}
