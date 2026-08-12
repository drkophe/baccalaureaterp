import { currentCategory, expectedVoteCount, votersDone } from '../game/engine';
import { isBlankAnswer } from './sanitize';
import type {
  AnswerMap,
  ClientRound,
  ClientSession,
  Player,
  Round,
  Session,
  VoteMap,
} from './types';

/**
 * Projection de l'etat serveur vers un client donne.
 *
 * C'est la seule frontiere par laquelle l'etat sort du serveur : tout ce qui ne
 * doit pas fuiter (secrets de reconnexion, reponses des autres joueurs pendant la
 * manche, votes en cours) est retire ici, jamais cache uniquement cote UI.
 */
export function redactSession(
  session: Session,
  viewerId: string | null,
  now: number,
): ClientSession {
  return {
    code: session.code,
    version: session.version,
    phase: session.phase,
    hostId: session.hostId,
    players: session.players.map(toPublicPlayer),
    settings: session.settings,
    usedLetters: session.usedLetters,
    round: session.round ? redactRound(session, session.round, viewerId) : null,
    deadline: session.deadline,
    completedRounds: session.completedRounds,
    serverNow: now,
  };
}

function toPublicPlayer(player: Session['players'][number]): Player {
  return {
    id: player.id,
    nickname: player.nickname,
    connected: player.connected,
    joinedAt: player.joinedAt,
    lastSeenAt: player.lastSeenAt,
    disconnectedAt: player.disconnectedAt,
    ready: player.ready,
    totalScore: player.totalScore,
  };
}

function redactRound(session: Session, round: Round, viewerId: string | null): ClientRound {
  return {
    index: round.index,
    // La lettre reste secrete pendant l'animation de tirage : sinon un joueur
    // pourrait la lire dans les devtools et gagner quelques secondes de reflexion.
    letter: session.phase === 'letter_draw' ? '' : round.letter,
    startedAt: round.startedAt,
    endsAt: round.endsAt,
    stoppedAt: round.stoppedAt,
    stoppedBy: round.stoppedBy,
    stopReason: round.stopReason,
    categories: round.categories,
    participants: round.participants,
    answers: visibleAnswers(session, round, viewerId),
    votes: visibleVotes(round, viewerId),
    resolved: round.resolved,
    reviewIndex: round.reviewIndex,
    revealCursor: round.revealCursor,
    revealOrder: round.revealOrder,
    roundScores: round.roundScores,
    filledCounts: countFilledAnswers(round),
    votersDone: session.phase === 'voting' ? votersDone(session, round) : [],
    votesExpected: session.phase === 'voting' ? expectedVoteCount(session, round) : 0,
  };
}

/**
 * Reponses visibles par le spectateur :
 * - toujours les siennes ;
 * - pendant la manche, rien de plus (c'est le coeur du jeu) ;
 * - pendant la revue, les categories deja traitees, et la categorie courante
 *   uniquement jusqu'au curseur de revelation ;
 * - une fois la manche finie, tout.
 */
function visibleAnswers(session: Session, round: Round, viewerId: string | null): AnswerMap {
  const visible: AnswerMap = {};

  const addAll = (playerId: string): void => {
    const answers = round.answers[playerId];
    if (answers) visible[playerId] = { ...answers };
  };

  if (viewerId) addAll(viewerId);

  if (session.phase === 'letter_draw' || session.phase === 'round_active') {
    return visible;
  }

  if (session.phase === 'round_results' || session.phase === 'game_over') {
    for (const playerId of round.participants) addAll(playerId);
    return visible;
  }

  // Phases de revue : on ouvre categorie par categorie.
  const pastCategories = round.categories
    .slice(0, round.reviewIndex)
    .map((category) => category.id);
  const current = currentCategory(round);

  const revealedForCurrent =
    session.phase === 'reveal'
      ? round.revealOrder.slice(0, round.revealCursor)
      : round.participants;

  for (const playerId of round.participants) {
    const source = round.answers[playerId];
    if (!source) continue;
    const target = visible[playerId] ?? {};

    for (const categoryId of pastCategories) {
      target[categoryId] = source[categoryId] ?? '';
    }
    if (current && revealedForCurrent.includes(playerId)) {
      target[current.id] = source[current.id] ?? '';
    }
    visible[playerId] = target;
  }

  return visible;
}

/**
 * Les votes des autres restent secrets tant que la categorie n'est pas close :
 * on ne renvoie que ses propres votes (pour reafficher sa selection apres un
 * refresh). Le detail agrege arrive ensuite via `resolved[].voteTally`.
 */
function visibleVotes(round: Round, viewerId: string | null): VoteMap {
  if (!viewerId) return {};
  const visible: VoteMap = {};

  for (const [categoryId, byTarget] of Object.entries(round.votes)) {
    for (const [targetId, byVoter] of Object.entries(byTarget)) {
      const own = byVoter[viewerId];
      if (own === undefined) continue;
      const category = visible[categoryId] ?? {};
      category[targetId] = { [viewerId]: own };
      visible[categoryId] = category;
    }
  }

  return visible;
}

/** Nombre de champs remplis par joueur : la seule info de progression diffusee en manche. */
export function countFilledAnswers(round: Round): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const playerId of round.participants) {
    const answers = round.answers[playerId] ?? {};
    counts[playerId] = round.categories.filter(
      (category) => !isBlankAnswer(answers[category.id]),
    ).length;
  }
  return counts;
}
