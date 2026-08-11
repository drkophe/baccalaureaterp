import { AUTO_SCORE, STOPPER_PENALTY_POINTS } from '../constants.js';
import { isBlankAnswer, normalizeAnswer, startsWithLetter } from '../sanitize.js';
import type {
  Player,
  ResolvedScore,
  ScoreboardEntry,
  ScoringMode,
  StopReason,
  VotePoints,
} from '../types.js';

export interface CategoryScoringInput {
  /** Joueurs participant a la manche (definit aussi les votants eligibles). */
  participants: string[];
  /** answers[playerId] : reponse du joueur pour cette categorie. */
  answers: Record<string, string | undefined>;
  /** votes[targetPlayerId][voterId] : points attribues. */
  votes: Record<string, Record<string, VotePoints>>;
  letter: string;
  scoringMode: ScoringMode;
  /** Joueur ayant declenche le Stop, `null` si la manche s'est terminee au chrono. */
  stopperId: string | null;
  stopReason: StopReason | null;
  stopperPenalty: boolean;
}

/**
 * Note automatique d'une reponse, facon Petit Bac classique :
 * vide ou mauvaise lettre = 0, reponse partagee avec un autre joueur = 1, unique = 2.
 */
export function computeAutoScore(
  playerId: string,
  answers: Record<string, string | undefined>,
  participants: string[],
  letter: string,
): { base: VotePoints; empty: boolean; duplicateWith: string[] } {
  const raw = answers[playerId] ?? '';
  const empty = isBlankAnswer(raw);

  if (empty || !startsWithLetter(raw, letter)) {
    return { base: AUTO_SCORE.EMPTY, empty, duplicateWith: [] };
  }

  const mine = normalizeAnswer(raw);
  const duplicateWith = participants.filter((other) => {
    if (other === playerId) return false;
    const otherRaw = answers[other] ?? '';
    if (isBlankAnswer(otherRaw) || !startsWithLetter(otherRaw, letter)) return false;
    return normalizeAnswer(otherRaw) === mine;
  });

  return {
    base: duplicateWith.length > 0 ? AUTO_SCORE.DUPLICATE : AUTO_SCORE.UNIQUE,
    empty,
    duplicateWith,
  };
}

/**
 * Agrege les votes exprimes par la mediane (arrondi superieur sur une mediane a
 * .5). La mediane resiste a un vote isole malveillant, contrairement a la moyenne.
 */
export function resolveVotes(values: VotePoints[]): VotePoints | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] as VotePoints;
  }
  const low = sorted[middle - 1] as number;
  const high = sorted[middle] as number;
  return Math.round((low + high) / 2) as VotePoints;
}

/** Repartition des votes exprimes : index = points attribues. */
export function tallyVotes(values: VotePoints[]): [number, number, number] {
  const tally: [number, number, number] = [0, 0, 0];
  for (const value of values) {
    tally[value] += 1;
  }
  return tally;
}

/**
 * Votants eligibles pour une reponse : tous les participants de la manche,
 * sauf l'auteur de la reponse (on ne note pas ses propres reponses).
 */
export function eligibleVoters(participants: string[], ownerId: string): string[] {
  return participants.filter((id) => id !== ownerId);
}

/**
 * Resout le score d'une categorie pour tous les participants.
 *
 * - `auto`   : uniquement la regle classique, les votes sont ignores.
 * - `vote`   : uniquement le vote des joueurs (repli sur la regle classique si
 *              personne n'a vote, cas d'une partie a un seul joueur).
 * - `hybrid` : la regle classique sert de proposition par defaut dans l'UI,
 *              mais les votes exprimes font foi.
 *
 * Regle speciale : une reponse du joueur ayant declenche le Stop qui retombe a 0
 * vaut -1 (penalite pour avoir coupe la manche sans reponse valable). Elle ne
 * s'applique jamais quand la manche s'est terminee au chronometre.
 */
export function resolveCategory(input: CategoryScoringInput): Record<string, ResolvedScore> {
  const { participants, answers, votes, letter, scoringMode, stopperId, stopReason } = input;
  const penaltyActive = input.stopperPenalty && stopReason === 'player' && stopperId !== null;

  const result: Record<string, ResolvedScore> = {};

  for (const playerId of participants) {
    const auto = computeAutoScore(playerId, answers, participants, letter);
    const castVotes = collectCastVotes(votes[playerId], participants, playerId);

    let base: VotePoints = auto.base;
    if (scoringMode !== 'auto') {
      base = resolveVotes(castVotes) ?? auto.base;
    }

    const applyPenalty = penaltyActive && playerId === stopperId && base === 0;

    result[playerId] = {
      points: applyPenalty ? STOPPER_PENALTY_POINTS : base,
      base,
      penalty: applyPenalty,
      empty: auto.empty,
      duplicateWith: auto.duplicateWith,
      voteTally: tallyVotes(castVotes),
    };
  }

  return result;
}

/** Ne retient que les votes provenant d'un votant reellement eligible. */
function collectCastVotes(
  votesForTarget: Record<string, VotePoints> | undefined,
  participants: string[],
  ownerId: string,
): VotePoints[] {
  if (!votesForTarget) return [];
  const allowed = new Set(eligibleVoters(participants, ownerId));
  const values: VotePoints[] = [];
  for (const [voterId, points] of Object.entries(votesForTarget)) {
    if (!allowed.has(voterId)) continue;
    values.push(points);
  }
  return values;
}

/** Somme des points d'une categorie deja resolue, par joueur. */
export function sumCategoryPoints(resolved: Record<string, ResolvedScore>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [playerId, score] of Object.entries(resolved)) {
    totals[playerId] = score.points;
  }
  return totals;
}

/** Classement, les ex aequo partageant le meme rang. */
export function buildScoreboard(
  players: Pick<Player, 'id' | 'nickname' | 'totalScore'>[],
): ScoreboardEntry[] {
  const sorted = [...players].sort(
    (a, b) => b.totalScore - a.totalScore || a.nickname.localeCompare(b.nickname),
  );

  let lastScore: number | null = null;
  let lastRank = 0;

  return sorted.map((player, index) => {
    const rank = lastScore !== null && player.totalScore === lastScore ? lastRank : index + 1;
    lastScore = player.totalScore;
    lastRank = rank;
    return {
      playerId: player.id,
      nickname: player.nickname,
      totalScore: player.totalScore,
      rank,
    };
  });
}
