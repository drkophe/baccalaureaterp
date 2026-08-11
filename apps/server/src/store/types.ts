import type { Session } from '@bacc/shared';

/**
 * Contrat du store de sessions. Deux implementations : Redis (production,
 * multi-instance) et memoire (developpement local sans Redis).
 *
 * Toute mutation passe par `withLock` : plusieurs instances peuvent traiter
 * simultanement des evenements de la meme session (deux joueurs sur deux
 * pods differents), il faut donc serialiser lecture -> mutation -> ecriture.
 */
export interface SessionStore {
  /** Cree la session si le code est libre. Retourne `false` en cas de collision. */
  create(session: Session): Promise<boolean>;
  get(code: string): Promise<Session | null>;
  /** Ecrit la session et rafraichit son TTL. */
  save(session: Session): Promise<void>;
  delete(code: string): Promise<void>;

  /**
   * Charge la session, applique la mutation, puis la sauvegarde, sous verrou
   * distribue. Si le callback leve, rien n'est ecrit.
   */
  withLock<T>(code: string, mutate: (session: Session) => Promise<T> | T): Promise<T>;

  /** Echeances du moteur de jeu (fin de manche, pas de revelation, fin de vote...). */
  deadlines: TimerSet;
  /** Passages de menage (purge des joueurs deconnectes, sessions vides). */
  sweeps: TimerSet;

  /** Consommation d'un jeton de rate limiting. Retourne `true` si l'action passe. */
  consumeRateLimit(key: string, points: number, windowSeconds: number): Promise<boolean>;

  /** Nombre de sessions vivantes, pour les metriques du health check. */
  countSessions(): Promise<number>;

  close(): Promise<void>;
}

/**
 * File d'echeances triee par date, partagee entre instances : chaque entree
 * n'est reclamee que par une seule instance (`claimDue` est atomique).
 */
export interface TimerSet {
  schedule(member: string, at: number): Promise<void>;
  cancel(member: string): Promise<void>;
  /** Retire et retourne les entrees echues (au plus `limit`). */
  claimDue(now: number, limit: number): Promise<string[]>;
}
