import {
  currentCategory,
  redactSession,
  roomForSession,
  type Session,
  type StopReason,
} from '../../shared';
import type { GameContext } from '../context';
import type { GameServer } from './types';

/**
 * Chaque joueur recoit une projection differente de la meme session (ses
 * reponses, pas celles des autres). On emet donc socket par socket, via
 * `fetchSockets()` qui traverse l'adapter Redis et couvre toutes les instances.
 */
export async function broadcastState(io: GameServer, session: Session): Promise<void> {
  const sockets = await io.in(roomForSession(session.code)).fetchSockets();
  const now = Date.now();
  for (const socket of sockets) {
    socket.emit('session:state', redactSession(session, socket.data.playerId, now));
  }
}

/** Etat instantane servant a deduire les evenements d'animation a emettre. */
export interface PhaseSnapshot {
  phase: Session['phase'];
  roundIndex: number;
  reviewIndex: number;
  revealCursor: number;
  hostId: string;
}

export function snapshot(session: Session): PhaseSnapshot {
  return {
    phase: session.phase,
    roundIndex: session.round?.index ?? -1,
    reviewIndex: session.round?.reviewIndex ?? -1,
    revealCursor: session.round?.revealCursor ?? -1,
    hostId: session.hostId,
  };
}

/**
 * Emet les evenements ephemeres (animations, sons) deduits du passage d'un etat
 * a un autre. Centralise ici pour que les handlers ET l'ordonnanceur produisent
 * exactement les memes effets, quelle que soit l'origine de la transition.
 */
export function emitTransitionEffects(
  io: GameServer,
  session: Session,
  before: PhaseSnapshot,
): void {
  const room = roomForSession(session.code);
  const round = session.round;

  if (before.hostId !== session.hostId) {
    const host = session.players.find((player) => player.id === session.hostId);
    if (host) io.to(room).emit('host:changed', { hostId: host.id, nickname: host.nickname });
  }

  if (!round) return;

  // La lettre n'est devoilee qu'au demarrage effectif de la manche.
  if (before.phase === 'letter_draw' && session.phase === 'round_active') {
    io.to(room).emit('round:letter', { letter: round.letter, roundIndex: round.index });
  }

  if (before.phase === 'round_active' && session.phase === 'reveal') {
    const stopper = round.stoppedBy
      ? session.players.find((player) => player.id === round.stoppedBy)
      : null;
    io.to(room).emit('round:stopped', {
      reason: (round.stopReason ?? 'timeout') as StopReason,
      byPlayerId: round.stoppedBy,
      byNickname: stopper?.nickname ?? null,
    });
  }

  if (
    session.phase === 'reveal' &&
    session.round &&
    round.revealCursor > 0 &&
    (round.revealCursor !== before.revealCursor || round.reviewIndex !== before.reviewIndex)
  ) {
    const category = currentCategory(round);
    const playerId = round.revealOrder[round.revealCursor - 1];
    if (category && playerId) {
      io.to(room).emit('reveal:step', {
        categoryId: category.id,
        playerId,
        index: round.revealCursor - 1,
      });
    }
  }

  if (before.phase !== 'category_results' && session.phase === 'category_results') {
    const category = round.categories[round.reviewIndex];
    if (category) io.to(room).emit('category:closed', { categoryId: category.id });
  }
}

/** Aligne la file d'echeances partagee sur l'echeance courante de la session. */
export async function syncDeadline(ctx: GameContext, session: Session): Promise<void> {
  if (session.deadline) {
    await ctx.store.deadlines.schedule(session.code, session.deadline.at);
  } else {
    await ctx.store.deadlines.cancel(session.code);
  }
}
