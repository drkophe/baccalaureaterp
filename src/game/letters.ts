import { DEFAULT_LETTER_POOL } from '../shared/constants';

/**
 * Tire une lettre au hasard dans le pool, en excluant si demande les lettres
 * deja sorties. Si toutes les lettres ont ete jouees, le pool est reinitialise
 * plutot que de bloquer la partie.
 */
export function drawLetter(
  pool: string,
  usedLetters: readonly string[],
  excludeUsed: boolean,
  random: () => number = Math.random,
): string {
  const letters = normalizePool(pool);
  const used = new Set(usedLetters.map((letter) => letter.toUpperCase()));

  let candidates = excludeUsed ? letters.filter((letter) => !used.has(letter)) : letters;
  if (candidates.length === 0) candidates = letters;

  const index = Math.floor(random() * candidates.length);
  return candidates[Math.min(index, candidates.length - 1)] as string;
}

/** Nettoie un pool saisi par l'hote : lettres A-Z uniques, repli sur le pool par defaut. */
export function normalizePool(pool: string): string[] {
  const letters = Array.from(
    new Set(
      pool
        .toUpperCase()
        .split('')
        .filter((char) => char >= 'A' && char <= 'Z'),
    ),
  );
  return letters.length > 0 ? letters : DEFAULT_LETTER_POOL.split('');
}

/** Melange de Fisher-Yates, avec source d'alea injectable pour les tests. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return result;
}
