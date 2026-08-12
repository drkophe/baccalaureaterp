import { z } from 'zod';
import { SESSION_CODE_ALPHABET } from './codes';
import { LIMITS } from './constants';
import { sanitizeText } from './sanitize';

/**
 * Schemas de validation de tout ce qui entre par le socket ou l'API HTTP.
 * Regle : rien n'atteint le moteur de jeu sans etre passe par ici, et le texte
 * ressort deja assaini (`sanitizeText`), pas seulement verifie.
 */

const codePattern = new RegExp(`^[${SESSION_CODE_ALPHABET}]{${LIMITS.SESSION_CODE_LENGTH}}$`);

export const sessionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(codePattern, 'Code de partie invalide');

export const nicknameSchema = z
  .string()
  .max(LIMITS.NICKNAME_MAX * 4)
  .transform((value) => sanitizeText(value, LIMITS.NICKNAME_MAX))
  .refine((value) => value.length >= LIMITS.NICKNAME_MIN, 'Pseudo requis');

export const categoryLabelSchema = z
  .string()
  .max(LIMITS.CATEGORY_MAX * 4)
  .transform((value) => sanitizeText(value, LIMITS.CATEGORY_MAX))
  .refine((value) => value.length >= LIMITS.CATEGORY_MIN, 'Categorie requise');

export const answerValueSchema = z
  .string()
  .max(LIMITS.ANSWER_MAX * 4)
  .transform((value) => sanitizeText(value, LIMITS.ANSWER_MAX));

/** Identifiants opaques generes par le serveur (nanoid-like). */
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Identifiant invalide');

export const tokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Token invalide');

export const votePointsSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const letterPoolSchema = z
  .string()
  .max(64)
  .transform((value) => value.toUpperCase().replace(/[^A-Z]/g, ''))
  .refine((value) => value.length > 0, 'Au moins une lettre');

/* ----------------------------- Payloads socket ---------------------------- */

export const joinPayloadSchema = z.object({
  code: sessionCodeSchema,
  nickname: nicknameSchema,
  playerId: idSchema.optional(),
  token: tokenSchema.optional(),
});

export const createSessionSchema = z.object({
  nickname: nicknameSchema,
});

export const settingsUpdateSchema = z
  .object({
    roundDurationSeconds: z
      .number()
      .int()
      .min(LIMITS.MIN_ROUND_DURATION)
      .max(LIMITS.MAX_ROUND_DURATION)
      .nullable(),
    roundCount: z.number().int().min(LIMITS.MIN_ROUNDS).max(LIMITS.MAX_ROUNDS),
    playersCanAddCategories: z.boolean(),
    scoringMode: z.enum(['auto', 'vote', 'hybrid']),
    stopperPenalty: z.boolean(),
    voteDurationSeconds: z
      .number()
      .int()
      .min(LIMITS.MIN_VOTE_DURATION)
      .max(LIMITS.MAX_VOTE_DURATION)
      .nullable(),
    excludeUsedLetters: z.boolean(),
    letterPool: letterPoolSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Aucun changement');

export const categoryAddSchema = z.object({ label: categoryLabelSchema });

export const categoryRemoveSchema = z.object({ categoryId: idSchema });

export const categoryReorderSchema = z.object({
  categoryIds: z.array(idSchema).max(LIMITS.MAX_CATEGORIES),
});

export const readySchema = z.object({ ready: z.boolean() });

export const answerSchema = z.object({
  categoryId: idSchema,
  value: answerValueSchema,
});

export const voteSchema = z.object({
  categoryId: idSchema,
  targetPlayerId: idSchema,
  points: votePointsSchema,
});

export type JoinInput = z.infer<typeof joinPayloadSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
export type AnswerInput = z.infer<typeof answerSchema>;
export type VoteInput = z.infer<typeof voteSchema>;
