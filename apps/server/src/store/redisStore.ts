import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { GameError, TIMINGS, type Session } from '@bacc/shared';
import type { SessionStore, TimerSet } from './types.js';

const LOCK_TTL_MS = 5_000;
const LOCK_RETRY_DELAY_MS = 25;
const LOCK_MAX_ATTEMPTS = 120; // ~3 s d'attente maximum avant d'abandonner.

/** Liberation du verrou uniquement si on en est toujours proprietaire. */
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Reclamation atomique des echeances : une entree n'est servie qu'a une instance. */
const CLAIM_DUE_SCRIPT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
if #due > 0 then
  redis.call('ZREM', KEYS[1], unpack(due))
end
return due
`;

/** Compteur glissant : incremente puis pose le TTL au premier appel de la fenetre. */
const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
if current > tonumber(ARGV[1]) then
  return 0
end
return 1
`;

class RedisTimerSet implements TimerSet {
  constructor(
    private readonly redis: Redis,
    private readonly key: string,
  ) {}

  async schedule(member: string, at: number): Promise<void> {
    await this.redis.zadd(this.key, at, member);
  }

  async cancel(member: string): Promise<void> {
    await this.redis.zrem(this.key, member);
  }

  async claimDue(now: number, limit: number): Promise<string[]> {
    const result = (await this.redis.eval(
      CLAIM_DUE_SCRIPT,
      1,
      this.key,
      String(now),
      String(limit),
    )) as string[] | null;
    return result ?? [];
  }
}

export class RedisSessionStore implements SessionStore {
  readonly deadlines: TimerSet;
  readonly sweeps: TimerSet;

  private readonly ttlSeconds = TIMINGS.SESSION_TTL_SECONDS;

  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {
    this.deadlines = new RedisTimerSet(redis, this.key('deadlines'));
    this.sweeps = new RedisTimerSet(redis, this.key('sweeps'));
  }

  private key(...parts: string[]): string {
    return [this.prefix, ...parts].join(':');
  }

  private sessionKey(code: string): string {
    return this.key('session', code);
  }

  async create(session: Session): Promise<boolean> {
    const result = await this.redis.set(
      this.sessionKey(session.code),
      JSON.stringify(session),
      'EX',
      this.ttlSeconds,
      'NX',
    );
    if (result !== 'OK') return false;
    await this.redis.sadd(this.key('sessions'), session.code);
    return true;
  }

  async get(code: string): Promise<Session | null> {
    const raw = await this.redis.get(this.sessionKey(code));
    if (!raw) {
      // La cle a expire : on retire le code de l'index pour qu'il ne derive pas.
      await this.redis.srem(this.key('sessions'), code);
      return null;
    }
    try {
      return JSON.parse(raw) as Session;
    } catch {
      // Donnee corrompue : on la supprime plutot que de la propager au moteur.
      await this.delete(code);
      return null;
    }
  }

  async save(session: Session): Promise<void> {
    await this.redis.set(
      this.sessionKey(session.code),
      JSON.stringify(session),
      'EX',
      this.ttlSeconds,
    );
  }

  async delete(code: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.sessionKey(code)),
      this.redis.srem(this.key('sessions'), code),
      this.deadlines.cancel(code),
      this.sweeps.cancel(code),
    ]);
  }

  async withLock<T>(code: string, mutate: (session: Session) => Promise<T> | T): Promise<T> {
    const lockKey = this.key('lock', code);
    const token = randomBytes(12).toString('hex');
    const acquired = await this.acquireLock(lockKey, token);
    if (!acquired) {
      throw new GameError('INTERNAL_ERROR', 'Session occupee, reessaie');
    }

    try {
      const session = await this.get(code);
      if (!session) throw new GameError('SESSION_NOT_FOUND');
      const result = await mutate(session);
      await this.save(session);
      return result;
    } finally {
      await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token).catch(() => undefined);
    }
  }

  private async acquireLock(lockKey: string, token: string): Promise<boolean> {
    for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
      const result = await this.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
      if (result === 'OK') return true;
      await delay(LOCK_RETRY_DELAY_MS);
    }
    return false;
  }

  async consumeRateLimit(key: string, points: number, windowSeconds: number): Promise<boolean> {
    const allowed = (await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      this.key('rl', key),
      String(points),
      String(windowSeconds),
    )) as number;
    return allowed === 1;
  }

  async countSessions(): Promise<number> {
    return this.redis.scard(this.key('sessions'));
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
