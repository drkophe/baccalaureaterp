import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { createSessionSchema, isGameError, messageForCode, RATE_LIMITS } from '@bacc/shared';
import { createNewSession, type GameContext } from '../game/context.js';

/**
 * API HTTP minimale : creation de partie, health check, et rien d'autre.
 * Tout le jeu passe par le socket ; l'API sert surtout a obtenir un code avant
 * meme d'ouvrir la connexion temps reel.
 */
export function createApp(ctx: GameContext) {
  const app = express();
  const { config, logger } = ctx;

  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // L'API ne sert aucune page : une CSP stricte suffit.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    }),
  );
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const sessions = await ctx.store.countSessions();
      res.json({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        sessions,
        version: process.env.npm_package_version ?? '1.0.0',
      });
    } catch (error) {
      // Le health check doit refleter l'etat reel du store, pas mentir en cas de panne Redis.
      logger.error({ err: error }, 'Health check en echec');
      res.status(503).json({ status: 'degraded' });
    }
  });

  app.post('/api/sessions', async (req: Request, res: Response) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_PAYLOAD', message: messageForCode('INVALID_PAYLOAD') });
      return;
    }

    const limit = RATE_LIMITS.CREATE_SESSION;
    const allowed = await ctx.store.consumeRateLimit(
      `http:create:${req.ip ?? 'unknown'}`,
      limit.points,
      limit.windowSeconds,
    );
    if (!allowed) {
      res.status(429).json({ code: 'RATE_LIMITED', message: messageForCode('RATE_LIMITED') });
      return;
    }

    try {
      const created = await createNewSession(ctx, parsed.data.nickname);
      res.status(201).json({
        code: created.session.code,
        playerId: created.playerId,
        token: created.token,
      });
    } catch (error) {
      if (isGameError(error)) {
        res.status(400).json({ code: error.code, message: messageForCode(error.code) });
        return;
      }
      logger.error({ err: error }, 'Creation de session en echec');
      res.status(500).json({ code: 'INTERNAL_ERROR', message: messageForCode('INTERNAL_ERROR') });
    }
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Ressource introuvable' });
  });

  // Filet de securite : une erreur non geree renvoie une reponse propre, pas une stack.
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: error }, 'Erreur HTTP non geree');
    res.status(500).json({ code: 'INTERNAL_ERROR', message: messageForCode('INTERNAL_ERROR') });
  });

  return app;
}
