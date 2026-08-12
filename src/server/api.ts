import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { createSessionSchema, isGameError, messageForCode, RATE_LIMITS } from '../shared';
import { createNewSession, type GameContext } from './context';

/**
 * Routeur HTTP place devant Next.js : health check et creation de partie.
 * Tout ce qui n'est pas reconnu ici est transmis au routeur de Next.
 */
export function createApiRouter(ctx: GameContext) {
  const app = express();
  const { config, logger } = ctx;

  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Le process sert aussi les pages : la CSP doit autoriser le front Next
      // (scripts d'hydratation en ligne, styles injectes) et le WebSocket.
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'", 'ws:', 'wss:'],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
            },
          }
        : false,
      // Bloquerait le chargement des ressources Next en developpement.
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(compression());

  // Inutile en meme origine : n'est monte que si un front distant est declare.
  if (config.crossOrigin) {
    app.use(cors({ origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST'] }));
  }

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const sessions = await ctx.store.countSessions();
      res.json({ status: 'ok', uptime: Math.round(process.uptime()), sessions });
    } catch (error) {
      // Le health check doit refleter l'etat reel du store, pas mentir en cas de panne.
      logger.error({ err: error }, 'Health check en echec');
      res.status(503).json({ status: 'degraded' });
    }
  });

  app.post('/api/sessions', express.json({ limit: '8kb' }), async (req: Request, res: Response) => {
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

  // Filet de securite : une erreur non geree renvoie une reponse propre, pas une stack.
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: error }, 'Erreur HTTP non geree');
    res.status(500).json({ code: 'INTERNAL_ERROR', message: messageForCode('INTERNAL_ERROR') });
  });

  return app;
}
