import { LIMITS } from './constants.js';

/**
 * Alphabet des codes de session : ni O/0 ni I/1/L, pour qu'un code lu a voix
 * haute ou recopie depuis un telephone ne soit jamais ambigu.
 */
export const SESSION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const CODE_PATTERN = new RegExp(`^[${SESSION_CODE_ALPHABET}]{${LIMITS.SESSION_CODE_LENGTH}}$`);

/** Normalise une saisie utilisateur (minuscules, espaces, tirets colles au code). */
export function normalizeSessionCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, LIMITS.SESSION_CODE_LENGTH);
}

export function isValidSessionCode(input: string): boolean {
  return CODE_PATTERN.test(input);
}
