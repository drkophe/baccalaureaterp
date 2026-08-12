import type { ErrorCode } from './errors';
import type { ClientSession, ScoringMode, StopReason, VotePoints } from './types';

/* -------------------------------------------------------------------------- */
/*                          Payloads client -> serveur                         */
/* -------------------------------------------------------------------------- */

export interface JoinPayload {
  code: string;
  nickname: string;
  /** Identifiants de reconnexion issus du `localStorage`, si le joueur revient. */
  playerId?: string;
  token?: string;
}

export interface SettingsUpdatePayload {
  roundDurationSeconds?: number | null;
  roundCount?: number;
  playersCanAddCategories?: boolean;
  scoringMode?: ScoringMode;
  stopperPenalty?: boolean;
  voteDurationSeconds?: number | null;
  excludeUsedLetters?: boolean;
  letterPool?: string;
}

export interface CategoryAddPayload {
  label: string;
}

export interface CategoryRemovePayload {
  categoryId: string;
}

export interface CategoryReorderPayload {
  categoryIds: string[];
}

export interface ReadyPayload {
  ready: boolean;
}

export interface AnswerPayload {
  categoryId: string;
  value: string;
}

export interface VotePayload {
  /** Categorie visee : rejetee si elle n'est plus celle en cours de vote. */
  categoryId: string;
  targetPlayerId: string;
  points: VotePoints;
}

/* -------------------------------------------------------------------------- */
/*                          Payloads serveur -> client                         */
/* -------------------------------------------------------------------------- */

export type JoinResult =
  | {
      ok: true;
      playerId: string;
      /** Secret de reconnexion, a stocker cote client. */
      token: string;
      session: ClientSession;
    }
  | { ok: false; code: ErrorCode; message: string };

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  /** Evenement a l'origine de l'erreur, pour cibler l'affichage cote UI. */
  origin?: string;
}

export interface NoticePayload {
  kind: 'info' | 'success' | 'warning';
  message: string;
}

export interface ProgressPayload {
  /** Nombre de champs remplis par joueur pendant la manche. */
  filledCounts: Record<string, number>;
}

export interface LetterPayload {
  letter: string;
  roundIndex: number;
}

export interface RoundStoppedPayload {
  reason: StopReason;
  byPlayerId: string | null;
  byNickname: string | null;
}

export interface RevealStepPayload {
  categoryId: string;
  playerId: string;
  /** Position dans l'ordre de revelation, 0-based. */
  index: number;
}

export interface CategoryClosedPayload {
  categoryId: string;
}

export interface PlayerEventPayload {
  playerId: string;
  nickname: string;
}

export interface HostChangedPayload {
  hostId: string;
  nickname: string;
}

/* -------------------------------------------------------------------------- */
/*                        Contrats Socket.io (typage fort)                     */
/* -------------------------------------------------------------------------- */

export interface ClientToServerEvents {
  'session:join': (payload: JoinPayload, ack: (result: JoinResult) => void) => void;
  'session:leave': () => void;
  'player:ready': (payload: ReadyPayload) => void;
  'settings:update': (payload: SettingsUpdatePayload) => void;
  'category:add': (payload: CategoryAddPayload) => void;
  'category:remove': (payload: CategoryRemovePayload) => void;
  'category:reorder': (payload: CategoryReorderPayload) => void;
  'game:start': () => void;
  'game:abort': () => void;
  'game:lobby': () => void;
  'round:answer': (payload: AnswerPayload) => void;
  'round:stop': () => void;
  'round:next': () => void;
  'vote:cast': (payload: VotePayload) => void;
}

export interface ServerToClientEvents {
  'session:state': (session: ClientSession) => void;
  'round:progress': (payload: ProgressPayload) => void;
  'round:letter': (payload: LetterPayload) => void;
  'round:stopped': (payload: RoundStoppedPayload) => void;
  'reveal:step': (payload: RevealStepPayload) => void;
  'category:closed': (payload: CategoryClosedPayload) => void;
  'player:joined': (payload: PlayerEventPayload) => void;
  'player:left': (payload: PlayerEventPayload) => void;
  'host:changed': (payload: HostChangedPayload) => void;
  notice: (payload: NoticePayload) => void;
  error: (payload: ErrorPayload) => void;
}

/** Donnees attachees au socket cote serveur apres authentification. */
export interface SocketData {
  sessionCode: string | null;
  playerId: string | null;
}

export const SOCKET_PATH = '/socket.io';

/** Nom de la room Socket.io regroupant les joueurs d'une session. */
export function roomForSession(code: string): string {
  return `session:${code}`;
}
