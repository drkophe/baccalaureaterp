/**
 * Assainissement de tout texte fourni par un client et susceptible d'etre
 * reaffiche chez les autres joueurs (pseudo, categorie, reponse).
 *
 * Le rendu se fait via React (qui echappe deja), mais on ne fait jamais confiance
 * a cette seule couche : on nettoie a l'entree, cote serveur, avant stockage.
 */

const MULTI_SPACE = /\s+/g;
const HTML_DELIMITERS = /[<>]/g;
const NON_ALPHANUM = /[^a-z0-9]+/g;

/** Caracteres de controle C0/C1 : remplaces par une espace. */
function isControl(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
}

/**
 * Caracteres invisibles a supprimer : espaces de largeur nulle, marques de
 * direction (utilisees pour deguiser un pseudo), separateurs de ligne, BOM.
 */
function isInvisible(cp: number): boolean {
  return (
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202f) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    cp === 0xfeff
  );
}

function stripUnsafeCodePoints(input: string): string {
  let out = '';
  for (const char of input) {
    const cp = char.codePointAt(0) ?? 0;
    if (isControl(cp)) {
      out += ' ';
      continue;
    }
    if (isInvisible(cp)) continue;
    out += char;
  }
  return out;
}

/**
 * Nettoie une chaine utilisateur : normalisation Unicode, suppression des
 * caracteres de controle/invisibles et des delimiteurs HTML, espaces compactes,
 * puis troncature a `maxLength`.
 */
export function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  const cleaned = stripUnsafeCodePoints(input.normalize('NFC'));
  return cleaned.replace(HTML_DELIMITERS, '').replace(MULTI_SPACE, ' ').trim().slice(0, maxLength);
}

/** Echappement HTML, pour tout rendu hors React (logs, exports, SSR manuel). */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Forme normalisee servant a comparer deux reponses entre elles (detection des
 * doublons). La decomposition NFD detache les accents, qui disparaissent ensuite
 * avec le reste de la ponctuation : "Éléphant" et "elephant" se rejoignent.
 */
export function normalizeAnswer(input: string): string {
  return input.normalize('NFD').toLowerCase().replace(NON_ALPHANUM, '');
}

/** Une reponse est vide si, une fois normalisee, il ne reste rien. */
export function isBlankAnswer(input: string | undefined | null): boolean {
  return !input || normalizeAnswer(input).length === 0;
}

/** La reponse commence-t-elle bien par la lettre tiree ? */
export function startsWithLetter(answer: string, letter: string): boolean {
  const normalized = normalizeAnswer(answer);
  const normalizedLetter = normalizeAnswer(letter);
  if (!normalized || !normalizedLetter) return false;
  return normalized.startsWith(normalizedLetter);
}
