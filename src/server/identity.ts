import { createHash, randomBytes, randomInt } from 'node:crypto';
import { LIMITS, SESSION_CODE_ALPHABET } from '../shared';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_ALPHABET = `${ID_ALPHABET}_-`;

/** Tire une chaine aleatoire dans un alphabet, avec une source cryptographique. */
function randomString(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    // Le modulo introduit un biais negligeable devant la taille de l'espace vise.
    out += alphabet[(bytes[i] as number) % alphabet.length];
  }
  return out;
}

/** Identifiant opaque (joueur, categorie) : non devinable. */
export function generateId(): string {
  return randomString(ID_ALPHABET, 12);
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
  return randomString(TOKEN_ALPHABET, 32);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparaison a temps constant : les hash ont toujours la meme longueur. */
export function verifyToken(token: string, expectedHash: string): boolean {
  const actual = hashToken(token);
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}
