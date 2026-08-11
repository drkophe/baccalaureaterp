/**
 * Identite locale du joueur. Il n'y a pas de compte : la seule chose qui permet
 * de retrouver sa place apres un refresh ou une coupure reseau est ce couple
 * (playerId, token) range dans le `localStorage`, par code de partie.
 */
export interface StoredIdentity {
  playerId: string;
  token: string;
  nickname: string;
}

const identityKey = (code: string): string => `bacc:identity:${code.toUpperCase()}`;
const NICKNAME_KEY = 'bacc:nickname';

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    // Le mode navigation privee de certains navigateurs fait lever l'acces.
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadIdentity(code: string): StoredIdentity | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(identityKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredIdentity>;
    if (!parsed.playerId || !parsed.token || !parsed.nickname) return null;
    return { playerId: parsed.playerId, token: parsed.token, nickname: parsed.nickname };
  } catch {
    return null;
  }
}

export function saveIdentity(code: string, identity: StoredIdentity): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(identityKey(code), JSON.stringify(identity));
    storage.setItem(NICKNAME_KEY, identity.nickname);
  } catch {
    // Quota plein ou stockage refuse : on continue sans persistance.
  }
}

export function clearIdentity(code: string): void {
  safeStorage()?.removeItem(identityKey(code));
}

/** Dernier pseudo utilise, pre-rempli dans les formulaires. */
export function lastNickname(): string {
  return safeStorage()?.getItem(NICKNAME_KEY) ?? '';
}
