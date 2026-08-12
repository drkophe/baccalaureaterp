/**
 * Modele de donnees de la session, partage entre le serveur (source de verite)
 * et le client (vue redigee par `redactSession`).
 */

export type GamePhase =
  /** Salon d'attente : configuration, joueurs qui arrivent. */
  | 'lobby'
  /** Animation de tirage de la lettre, aucune saisie possible. */
  | 'letter_draw'
  /** Manche en cours : les joueurs remplissent leurs reponses. */
  | 'round_active'
  /** Revelation des reponses de la categorie courante, une par une. */
  | 'reveal'
  /** Vote sur les reponses de la categorie courante. */
  | 'voting'
  /** Affichage du score de la categorie courante. */
  | 'category_results'
  /** Scores cumules apres la manche. */
  | 'round_results'
  /** Classement final. */
  | 'game_over';

export type ScoringMode = 'auto' | 'vote' | 'hybrid';

export type VotePoints = 0 | 1 | 2;

export type StopReason = 'player' | 'timeout';

export type DeadlineKind =
  'letter_draw' | 'round_end' | 'reveal_step' | 'vote_end' | 'category_results';

export interface Deadline {
  kind: DeadlineKind;
  /** Timestamp epoch ms auquel l'echeance doit se declencher. */
  at: number;
  /**
   * Jeton d'unicite : une echeance consommee ne peut pas etre rejouee
   * (protege contre les doubles declenchements en multi-instance).
   */
  seq: number;
}

export interface Player {
  id: string;
  nickname: string;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
  /** Timestamp de la deconnexion, sert a la fenetre de grace. */
  disconnectedAt: number | null;
  ready: boolean;
  totalScore: number;
}

/** Representation serveur : contient le secret de reconnexion, jamais diffusee. */
export interface ServerPlayer extends Player {
  /** SHA-256 du token de reconnexion remis au client. */
  tokenHash: string;
}

export interface Category {
  id: string;
  label: string;
  /** Id du joueur qui a ajoute la categorie (`'host'` pour la liste par defaut). */
  addedBy: string;
}

export interface Settings {
  /** Duree d'une manche en secondes, ou `null` pour une manche illimitee. */
  roundDurationSeconds: number | null;
  roundCount: number;
  categories: Category[];
  playersCanAddCategories: boolean;
  scoringMode: ScoringMode;
  /** Applique -1 au lieu de 0 aux reponses du joueur ayant stoppe la manche. */
  stopperPenalty: boolean;
  /** Duree max du vote d'une categorie, ou `null` pour attendre tous les votes. */
  voteDurationSeconds: number | null;
  /** Exclut du tirage les lettres deja sorties dans la partie. */
  excludeUsedLetters: boolean;
  /** Pool de lettres utilisable pour le tirage. */
  letterPool: string;
}

export interface ResolvedScore {
  /** Points finaux, malus stoppeur inclus. */
  points: number;
  /** Points issus du vote / du calcul automatique, avant malus. */
  base: VotePoints;
  /** Le malus stoppeur a-t-il ete applique ? */
  penalty: boolean;
  /** La reponse est-elle vide ? */
  empty: boolean;
  /** Ids des joueurs ayant donne la meme reponse (normalisee). */
  duplicateWith: string[];
  /** Repartition des votes exprimes : index = points, valeur = nombre de votes. */
  voteTally: [number, number, number];
}

/** answers[playerId][categoryId] = reponse brute (deja sanitizee). */
export type AnswerMap = Record<string, Record<string, string>>;

/** votes[categoryId][targetPlayerId][voterId] = points. */
export type VoteMap = Record<string, Record<string, Record<string, VotePoints>>>;

/** resolved[categoryId][playerId] = score resolu. */
export type ResolvedMap = Record<string, Record<string, ResolvedScore>>;

export interface Round {
  /** Index 0-based de la manche. */
  index: number;
  letter: string;
  startedAt: number | null;
  /** Timestamp de fin theorique (manche minutee), sinon `null`. */
  endsAt: number | null;
  stoppedAt: number | null;
  /** Joueur ayant declenche le Stop, `null` si fin au chronometre. */
  stoppedBy: string | null;
  stopReason: StopReason | null;
  /** Snapshot des categories au lancement : la liste ne bouge plus en cours de manche. */
  categories: Category[];
  /** Joueurs participant a cette manche (les retardataires n'y figurent pas). */
  participants: string[];
  answers: AnswerMap;
  votes: VoteMap;
  resolved: ResolvedMap;
  /** Index de la categorie en cours de revelation / vote. */
  reviewIndex: number;
  /** Nombre de reponses deja revelees dans la categorie courante. */
  revealCursor: number;
  /** Ordre de revelation des joueurs pour la categorie courante. */
  revealOrder: string[];
  /** Scores de la manche par joueur, remplis au fur et a mesure des categories. */
  roundScores: Record<string, number>;
}

/** Etat complet de la session, tel que stocke dans Redis. */
export interface Session {
  code: string;
  /** Incremente a chaque mutation : sert de garde anti-regression cote client. */
  version: number;
  phase: GamePhase;
  createdAt: number;
  updatedAt: number;
  hostId: string;
  players: ServerPlayer[];
  settings: Settings;
  usedLetters: string[];
  round: Round | null;
  deadline: Deadline | null;
  /** Compteur monotone alimentant `Deadline.seq`. */
  deadlineSeq: number;
  /** Manches terminees (utile pour le recap final). */
  completedRounds: number;
}

/* -------------------------------------------------------------------------- */
/*                             Vue client (redigee)                            */
/* -------------------------------------------------------------------------- */

export interface ClientRound {
  index: number;
  letter: string;
  startedAt: number | null;
  endsAt: number | null;
  stoppedAt: number | null;
  stoppedBy: string | null;
  stopReason: StopReason | null;
  categories: Category[];
  participants: string[];
  /** Mes reponses uniquement pendant la manche ; toutes une fois revelees. */
  answers: AnswerMap;
  votes: VoteMap;
  resolved: ResolvedMap;
  reviewIndex: number;
  revealCursor: number;
  revealOrder: string[];
  roundScores: Record<string, number>;
  /** Nombre de champs remplis par joueur, visible pendant la manche. */
  filledCounts: Record<string, number>;
  /** Joueurs ayant deja vote pour la categorie en cours. */
  votersDone: string[];
  /** Nombre de votes attendus pour la categorie en cours. */
  votesExpected: number;
}

export interface ClientSession {
  code: string;
  version: number;
  phase: GamePhase;
  hostId: string;
  players: Player[];
  settings: Settings;
  usedLetters: string[];
  round: ClientRound | null;
  deadline: Deadline | null;
  completedRounds: number;
  /** Horloge serveur au moment de l'envoi : permet de corriger la derive client. */
  serverNow: number;
}

export interface ScoreboardEntry {
  playerId: string;
  nickname: string;
  totalScore: number;
  rank: number;
}
