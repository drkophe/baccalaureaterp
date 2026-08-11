import { createHash, randomInt } from 'node:crypto';
import { customAlphabet, nanoid } from 'nanoid';
import { LIMITS, SESSION_CODE_ALPHABET } from '@bacc/shared';

const idAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const makeId = customAlphabet(idAlphabet, 12);

/** Identifiant opaque (joueur, categorie) : non devinable, sans caractere ambigu. */
export function generateId(): string {
  return makeId();
}

/** Code de partie court, lisible a voix haute. */
export function generateSessionCode(): string {
  let code = '';
  for (let i = 0; i < LIMITS.SESSION_CODE_LENGTH; i += 1) {
    code += SESSION_CODE_ALPHABET[randomInt(SESSION_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Secret de reconnexion remis au client (stocke dans son `localStorage`).
 * Seul son hash est conserve cote serveur : une fuite du store ne permet pas
 * d'usurper un joueur.
 */
export function generateToken(): string {
  return nanoid(32);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparaison a temps constant approxime : les hash ont toujours la meme longueur. */
export function verifyToken(token: string, expectedHash: string): boolean {
  const actual = hashToken(token);
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}
