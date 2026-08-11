import { createSession, type EngineDeps, GameError, type Session } from '@bacc/shared';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { SessionStore } from '../store/index.js';
import { generateId, generateSessionCode, generateToken, hashToken } from './identity.js';

/** Dependances injectees au moteur : horloge, alea et generateur d'identifiants. */
export const engineDeps: EngineDeps = {
  now: () => Date.now(),
  random: () => Math.random(),
  id: () => generateId(),
};

export interface GameContext {
  config: AppConfig;
  logger: Logger;
  store: SessionStore;
  deps: EngineDeps;
}

export interface CreatedSession {
  session: Session;
  playerId: string;
  token: string;
}

const MAX_CODE_ATTEMPTS = 12;

/**
 * Cree une session avec un code libre. En cas de collision (rare mais possible
 * sur ~28 millions de combinaisons), on retente avec un autre code plutot que
 * d'ecraser une partie en cours.
 */
export async function createNewSession(
  ctx: GameContext,
  nickname: string,
): Promise<CreatedSession> {
  const playerId = generateId();
  const token = generateToken();

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = generateSessionCode();
    const session = createSession(
      code,
      { id: playerId, nickname, tokenHash: hashToken(token) },
      ctx.deps,
    );

    const created = await ctx.store.create(session);
    if (created) {
      ctx.logger.info({ code, playerId }, 'Session creee');
      return { session, playerId, token };
    }
  }

  throw new GameError('INTERNAL_ERROR', 'Impossible de generer un code de partie libre');
}
