import { GameError } from '../shared/errors';
import type { GamePhase, Session } from '../shared/types';

/**
 * Machine a etats de la session. Toute transition passe par `transition()` :
 * un enchainement non declare ici est un bug, pas un cas a gerer silencieusement.
 *
 *   lobby -> letter_draw -> round_active -> reveal <-> voting -> category_results
 *     ^                                       ^__________________________|
 *     |                                    (categorie suivante)
 *     |                                                  |
 *     +-------------- round_results <--------------------+
 *                          |
 *                          +--> letter_draw (manche suivante)
 *                          +--> game_over --> lobby (rejouer)
 */
export const PHASE_TRANSITIONS: Record<GamePhase, readonly GamePhase[]> = {
  lobby: ['letter_draw'],
  letter_draw: ['round_active', 'lobby'],
  round_active: ['reveal', 'lobby'],
  reveal: ['voting', 'category_results', 'lobby'],
  voting: ['category_results', 'lobby'],
  category_results: ['reveal', 'round_results', 'lobby'],
  round_results: ['letter_draw', 'game_over', 'lobby'],
  game_over: ['lobby'],
};

/** Phases pendant lesquelles la partie n'a pas encore commence. */
export const LOBBY_PHASES: readonly GamePhase[] = ['lobby'];

/** Phases pendant lesquelles une manche est en cours d'examen (revelation/vote/scores). */
export const REVIEW_PHASES: readonly GamePhase[] = ['reveal', 'voting', 'category_results'];

/** Phases pendant lesquelles un nouvel arrivant ne peut pas participer a la manche. */
export const IN_GAME_PHASES: readonly GamePhase[] = [
  'letter_draw',
  'round_active',
  'reveal',
  'voting',
  'category_results',
  'round_results',
];

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

/** Applique une transition de phase, en refusant tout enchainement non prevu. */
export function transition(session: Session, to: GamePhase): void {
  if (session.phase === to) return;
  if (!canTransition(session.phase, to)) {
    throw new GameError('INVALID_PHASE', `Transition interdite: ${session.phase} -> ${to}`, {
      from: session.phase,
      to,
    });
  }
  session.phase = to;
}

/** Garde d'entree d'un handler : refuse l'action si la phase ne s'y prete pas. */
export function assertPhase(session: Session, allowed: readonly GamePhase[]): void {
  if (!allowed.includes(session.phase)) {
    throw new GameError('INVALID_PHASE', `Phase ${session.phase} incompatible`, {
      phase: session.phase,
      allowed: [...allowed],
    });
  }
}

export function isLobby(session: Session): boolean {
  return LOBBY_PHASES.includes(session.phase);
}

export function isRoundRunning(session: Session): boolean {
  return session.phase === 'round_active';
}

export function isReviewing(session: Session): boolean {
  return REVIEW_PHASES.includes(session.phase);
}
