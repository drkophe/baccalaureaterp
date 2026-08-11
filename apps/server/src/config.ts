import 'dotenv/config';
import { z } from 'zod';

/**
 * Configuration exclusivement issue de l'environnement : aucune valeur sensible
 * n'est ecrite en dur. Le process refuse de demarrer si la configuration est
 * invalide, plutot que de tourner avec des valeurs surprises.
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),

  /** Origines autorisees, separees par une virgule. Jamais de wildcard en prod. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  /** Prefixe des cles Redis, utile pour partager une instance entre environnements. */
  REDIS_PREFIX: z.string().default('bacc'),
  /**
   * Autorise le repli sur un store memoire quand Redis est injoignable.
   * Pratique en dev/test, interdit en production (casse le multi-instance).
   */
  ALLOW_MEMORY_STORE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Nombre de proxies de confiance devant l'app (pour obtenir la vraie IP). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
  /** Desactive le rate limiting (tests d'integration uniquement). */
  DISABLE_RATE_LIMIT: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuration invalide:\n  ${issues.join('\n  ')}`);
  }

  const config = parsed.data;
  const corsOrigins = parseOrigins(config.CORS_ORIGINS);
  const isProduction = config.NODE_ENV === 'production';

  if (isProduction) {
    if (corsOrigins.includes('*')) {
      throw new Error('CORS_ORIGINS ne peut pas valoir "*" en production.');
    }
    if (corsOrigins.length === 0) {
      throw new Error('CORS_ORIGINS doit lister au moins une origine en production.');
    }
    if (config.ALLOW_MEMORY_STORE) {
      throw new Error(
        'ALLOW_MEMORY_STORE=true est interdit en production : le store memoire casse le multi-instance.',
      );
    }
  }

  return { ...config, corsOrigins, isProduction };
}
