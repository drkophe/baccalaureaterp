/**
 * Limites, valeurs par defaut et constantes partagees entre le serveur et le client.
 * Toute limite appliquee cote serveur (validation) doit etre lisible cote client
 * pour pouvoir afficher les memes contraintes dans l'UI.
 */

export const LIMITS = {
  /** Longueur du code de session partageable. */
  SESSION_CODE_LENGTH: 5,
  NICKNAME_MIN: 1,
  NICKNAME_MAX: 20,
  CATEGORY_MIN: 1,
  CATEGORY_MAX: 32,
  ANSWER_MAX: 60,
  MAX_PLAYERS: 16,
  MAX_CATEGORIES: 16,
  MIN_CATEGORIES: 1,
  MAX_CATEGORIES_PER_PLAYER: 3,
  MIN_ROUNDS: 1,
  MAX_ROUNDS: 20,
  MIN_ROUND_DURATION: 15,
  MAX_ROUND_DURATION: 600,
  MIN_VOTE_DURATION: 5,
  MAX_VOTE_DURATION: 180,
} as const;

export const TIMINGS = {
  /** Duree de l'animation de tirage de la lettre (ms). */
  LETTER_DRAW_MS: 3_200,
  /** Delai entre deux reponses revelees dans une categorie (ms). */
  REVEAL_STEP_MS: 1_100,
  /** Temps d'affichage du score d'une categorie avant de passer a la suivante (ms). */
  CATEGORY_RESULTS_MS: 4_000,
  /** Fenetre de reconnexion avant de considerer un joueur reellement parti (ms). */
  DISCONNECT_GRACE_MS: 90_000,
  /** TTL d'une session inactive dans Redis (s). */
  SESSION_TTL_SECONDS: 6 * 60 * 60,
  /** Periode de la boucle d'echeances serveur (ms). */
  SCHEDULER_TICK_MS: 400,
} as const;

/** Lettres du tirage par defaut : on retire les lettres trop difficiles en francais. */
export const DEFAULT_LETTER_POOL = 'ABCDEFGHIJLMNOPRSTUV';
export const FULL_LETTER_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const DEFAULT_CATEGORY_LABELS = [
  'Pays',
  'Ville',
  'Prenom',
  'Animal',
  'Metier',
  'Fruit ou legume',
] as const;

/** Propositions affichees dans l'UI pour enrichir la liste rapidement. */
export const CATEGORY_SUGGESTIONS = [
  'Couleur',
  'Marque',
  'Film',
  'Chanteur / groupe',
  'Sport',
  'Objet de la maison',
  'Personnage de fiction',
  'Plat',
  'Partie du corps',
  'Instrument de musique',
  'Celebrite',
  'Vetement',
  'Jeu video',
  'Capitale',
  'Verbe',
  'Adjectif',
] as const;

export const SCORE_VALUES = [0, 1, 2] as const;

/** Points attribues automatiquement en mode `auto` / de base en mode `hybrid`. */
export const AUTO_SCORE = {
  EMPTY: 0,
  DUPLICATE: 1,
  UNIQUE: 2,
} as const;

/** Malus applique au joueur qui a stoppe la manche si sa reponse vaut 0. */
export const STOPPER_PENALTY_POINTS = -1;

export const RATE_LIMITS = {
  CREATE_SESSION: { points: 10, windowSeconds: 60 },
  JOIN_SESSION: { points: 30, windowSeconds: 60 },
  ANSWER_UPDATE: { points: 240, windowSeconds: 60 },
  VOTE: { points: 120, windowSeconds: 60 },
  CATEGORY_MUTATION: { points: 40, windowSeconds: 60 },
  SETTINGS_UPDATE: { points: 120, windowSeconds: 60 },
  GENERIC_ACTION: { points: 180, windowSeconds: 60 },
} as const;
