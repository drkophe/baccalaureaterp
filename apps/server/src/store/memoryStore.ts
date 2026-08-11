import { GameError, TIMINGS, type Session } from '@bacc/shared';
import type { SessionStore, TimerSet } from './types.js';

/**
 * Store en memoire, reserve au developpement local et aux tests.
 *
 * Il n'est PAS utilisable en production : rien n'est partage entre instances,
 * donc deux joueurs servis par deux processus differents ne se verraient pas.
 * `config.ts` refuse d'ailleurs de l'activer quand NODE_ENV vaut `production`.
 */
class MemoryTimerSet implements TimerSet {
  private readonly entries = new Map<string, number>();

  async schedule(member: string, at: number): Promise<void> {
    this.entries.set(member, at);
  }

  async cancel(member: string): Promise<void> {
    this.entries.delete(member);
  }

  async claimDue(now: number, limit: number): Promise<string[]> {
    const due: string[] = [];
    for (const [member, at] of this.entries) {
      if (at > now) continue;
      due.push(member);
      if (due.length >= limit) break;
    }
    for (const member of due) this.entries.delete(member);
    return due;
  }
}

interface StoredSession {
  session: Session;
  expiresAt: number;
}

export class MemorySessionStore implements SessionStore {
  readonly deadlines = new MemoryTimerSet();
  readonly sweeps = new MemoryTimerSet();

  private readonly sessions = new Map<string, StoredSession>();
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();
  /** Sequencement par session : reproduit la serialisation offerte par le verrou Redis. */
  private readonly locks = new Map<string, Promise<unknown>>();

  private ttlMs = TIMINGS.SESSION_TTL_SECONDS * 1000;

  async create(session: Session): Promise<boolean> {
    if (this.readFresh(session.code)) return false;
    this.sessions.set(session.code, { session, expiresAt: Date.now() + this.ttlMs });
    return true;
  }

  async get(code: string): Promise<Session | null> {
    return this.readFresh(code);
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.code, { session, expiresAt: Date.now() + this.ttlMs });
  }

  async delete(code: string): Promise<void> {
    this.sessions.delete(code);
    await this.deadlines.cancel(code);
    await this.sweeps.cancel(code);
  }

  async withLock<T>(code: string, mutate: (session: Session) => Promise<T> | T): Promise<T> {
    const previous = this.locks.get(code) ?? Promise.resolve();
    const run = previous.then(async () => {
      const session = this.readFresh(code);
      if (!session) throw new GameError('SESSION_NOT_FOUND');
      const result = await mutate(session);
      await this.save(session);
      return result;
    });

    // La chaine continue meme si cette mutation echoue, sinon le verrou reste bloque.
    this.locks.set(
      code,
      run.catch(() => undefined),
    );
    return run;
  }

  async consumeRateLimit(key: string, points: number, windowSeconds: number): Promise<boolean> {
    const now = Date.now();
    const entry = this.rateLimits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.rateLimits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= points;
  }

  async countSessions(): Promise<number> {
    this.purgeExpired();
    return this.sessions.size;
  }

  async close(): Promise<void> {
    this.sessions.clear();
    this.rateLimits.clear();
  }

  private readFresh(code: string): Session | null {
    const stored = this.sessions.get(code);
    if (!stored) return null;
    if (stored.expiresAt <= Date.now()) {
      this.sessions.delete(code);
      return null;
    }
    return stored.session;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [code, stored] of this.sessions) {
      if (stored.expiresAt <= now) this.sessions.delete(code);
    }
  }
}
