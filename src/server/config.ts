import 'dotenv/config';
import { z } from 'zod';

/**
 * Configuration issue de l'environnement.
 *
 * Choix volontaire : **aucune variable n'est obligatoire**. L'application demarre
 * telle quelle, en memoire, sur le port 3000. Les variables ci-dessous ne servent
 * qu'a lever des limites (plusieurs instances, domaine separe pour le front).
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** La plupart des hebergeurs (Render, Railway, Fly...) imposent le port par PORT. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),

  /**
   * Optionnel. Sans Redis, l'etat des parties vit dans la memoire du process :
   * parfait pour une instance unique, ce qui couvre largement une partie entre
   * amis. Renseigner cette variable active le partage entre plusieurs instances.
   */
  REDIS_URL: z.string().optional(),
  REDIS_PREFIX: z.string().default('bacc'),

  /**
   * Optionnel. Le front etant servi par ce meme process, il est en meme origine
   * et n'a besoin d'aucune autorisation CORS. A ne renseigner que si un front
   * heberge ailleurs doit pouvoir se connecter.
   */
  CORS_ORIGINS: z.string().default(''),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
  DISABLE_RATE_LIMIT: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuration invalide:\n  ${issues.join('\n  ')}`);
  }

  const config = parsed.data;
  const corsOrigins = config.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== '*');

  return {
    ...config,
    corsOrigins,
    isProduction: config.NODE_ENV === 'production',
    /** Vrai si un front d'une autre origine est explicitement autorise. */
    crossOrigin: corsOrigins.length > 0,
  };
}
