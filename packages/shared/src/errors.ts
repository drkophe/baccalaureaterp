/** Codes d'erreur applicatifs, partages pour que le client affiche un message adapte. */
export const ERROR_CODES = [
  'INVALID_PAYLOAD',
  'RATE_LIMITED',
  'SESSION_NOT_FOUND',
  'SESSION_FULL',
  'SESSION_CLOSED',
  'NICKNAME_TAKEN',
  'NOT_AUTHENTICATED',
  'NOT_HOST',
  'INVALID_PHASE',
  'NOT_PARTICIPANT',
  'GAME_ALREADY_STARTED',
  'NO_CATEGORIES',
  'CATEGORY_LIMIT_REACHED',
  'CATEGORY_DUPLICATE',
  'CATEGORY_NOT_FOUND',
  'CATEGORIES_LOCKED',
  'CANNOT_VOTE_OWN_ANSWER',
  'VOTE_NOT_OPEN',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Erreur metier attendue : convertie en evenement `error` cote socket, jamais en crash. */
export class GameError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    // Le code prefixe toujours le message : les logs et les assertions de test
    // n'ont pas a fouiller `details` pour savoir de quelle erreur il s'agit.
    super(message ? `${code}: ${message}` : code);
    this.name = 'GameError';
    this.code = code;
    this.details = details;
  }
}

export function isGameError(error: unknown): error is GameError {
  return error instanceof GameError;
}

/** Messages utilisateur en francais, indexes par code d'erreur. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_PAYLOAD: 'Donnees invalides.',
  RATE_LIMITED: 'Trop d actions en peu de temps, patiente un instant.',
  SESSION_NOT_FOUND: "Cette partie n'existe pas ou a expire.",
  SESSION_FULL: 'Cette partie est complete.',
  SESSION_CLOSED: 'Cette partie est terminee.',
  NICKNAME_TAKEN: 'Ce pseudo est deja pris dans cette partie.',
  NOT_AUTHENTICATED: 'Tu n es pas connecte a cette partie.',
  NOT_HOST: "Seul l'hote peut faire ca.",
  INVALID_PHASE: 'Action impossible a ce moment de la partie.',
  NOT_PARTICIPANT: 'Tu ne participes pas a cette manche.',
  GAME_ALREADY_STARTED: 'La partie a deja commence.',
  NO_CATEGORIES: 'Il faut au moins une categorie pour lancer la partie.',
  CATEGORY_LIMIT_REACHED: 'Limite de categories atteinte.',
  CATEGORY_DUPLICATE: 'Cette categorie existe deja.',
  CATEGORY_NOT_FOUND: 'Categorie introuvable.',
  CATEGORIES_LOCKED: "Seul l'hote peut modifier les categories.",
  CANNOT_VOTE_OWN_ANSWER: 'Tu ne peux pas voter pour ta propre reponse.',
  VOTE_NOT_OPEN: "Le vote n'est pas ouvert pour cette categorie.",
  INTERNAL_ERROR: 'Une erreur est survenue.',
};

export function messageForCode(code: ErrorCode): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
}
