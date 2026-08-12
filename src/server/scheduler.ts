import {
  abortToLobby,
  applyDeadline,
  findExpiredPlayers,
  isGameError,
  maybeCloseVoting,
  removePlayer,
  roomForSession,
  TIMINGS,
  type Session,
} from '../shared';
import { broadcastState, emitTransitionEffects, snapshot, syncDeadline } from './socket/broadcast';
import type { HandlerEnv } from './socket/guard';

const CLAIM_BATCH = 32;

/**
 * Horloge serveur partagee. Les echeances du jeu (fin de manche, pas de
 * revelation, fin de vote) ne peuvent pas reposer sur un `setTimeout` local :
 * l'instance qui l'a arme peut disparaitre, et une autre instance doit prendre
 * le relais. Elles vivent donc dans une file triee partagee (Redis ZSET), dont
 * chaque entree n'est reclamee que par une seule instance.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly env: HandlerEnv) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TIMINGS.SCHEDULER_TICK_MS);
    // Ne maintient pas le process en vie a lui seul.
    this.timer.unref?.();
    this.env.logger.info({ tickMs: TIMINGS.SCHEDULER_TICK_MS }, 'Ordonnanceur demarre');
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Un tour d'horloge. Ne leve jamais : une panne de tick ne doit pas tuer le process. */
  async tick(): Promise<void> {
    if (this.running) return; // Evite les tours qui se chevauchent.
    this.running = true;
    try {
      const now = Date.now();
      await this.processDeadlines(now);
      await this.processSweeps(now);
    } catch (error) {
      this.env.logger.error({ err: error }, 'Tour d ordonnanceur en echec');
    } finally {
      this.running = false;
    }
  }

  private async processDeadlines(now: number): Promise<void> {
    const codes = await this.env.store.deadlines.claimDue(now, CLAIM_BATCH);
    for (const code of codes) {
      await this.safely(code, () => this.applyDueDeadline(code, now));
    }
  }

  private async applyDueDeadline(code: string, now: number): Promise<void> {
    let before: ReturnType<typeof snapshot> | null = null;
    let applied = false;

    const session = await this.env.store.withLock(code, (current) => {
      before = snapshot(current);
      const deadline = current.deadline;
      if (!deadline) return current;

      if (deadline.at > now) {
        // Reclamee trop tot (horloges desynchronisees) : on la replanifie.
        return current;
      }
      applied = applyDeadline(current, deadline.seq, this.env.deps);
      return current;
    });

    await syncDeadline(this.env, session);

    if (applied && before) {
      emitTransitionEffects(this.env.io, session, before);
      await broadcastState(this.env.io, session);
      this.env.logger.debug({ code, phase: session.phase }, 'Echeance appliquee');
    }
  }

  /**
   * Menage : retire les joueurs dont la fenetre de reconnexion est ecoulee,
   * supprime les sessions devenues vides, et empeche une partie de rester
   * bloquee quand plus personne n'est connecte.
   */
  private async processSweeps(now: number): Promise<void> {
    const codes = await this.env.store.sweeps.claimDue(now, CLAIM_BATCH);
    for (const code of codes) {
      await this.safely(code, () => this.sweepSession(code, now));
    }
  }

  private async sweepSession(code: string, now: number): Promise<void> {
    let removed: Array<{ playerId: string; nickname: string }> = [];
    let before: ReturnType<typeof snapshot> | null = null;

    const session = await this.env.store.withLock(code, (current) => {
      before = snapshot(current);
      removed = findExpiredPlayers(current, now).map((playerId) => ({
        playerId,
        nickname: current.players.find((player) => player.id === playerId)?.nickname ?? '',
      }));
      for (const { playerId } of removed) {
        removePlayer(current, playerId, this.env.deps);
      }

      const anyoneConnected = current.players.some((player) => player.connected);
      if (!anyoneConnected && current.phase !== 'lobby') {
        // Plus personne en ligne : on ne laisse pas une manche tourner dans le vide.
        abortToLobby(current, this.env.deps);
      } else {
        maybeCloseVoting(current, this.env.deps);
      }
      return current;
    });

    if (session.players.length === 0) {
      await this.env.store.delete(code);
      this.env.logger.info({ code }, 'Session abandonnee supprimee');
      return;
    }

    await syncDeadline(this.env, session);

    if (removed.length > 0) {
      for (const player of removed) {
        this.env.io.to(roomForSession(code)).emit('player:left', player);
      }
      this.env.logger.info({ code, removed: removed.length }, 'Joueurs expires retires');
    }

    if (before) emitTransitionEffects(this.env.io, session, before);
    await broadcastState(this.env.io, session);

    // Tant qu'il reste des joueurs hors ligne, on repasse plus tard.
    if (session.players.some((player: Session['players'][number]) => !player.connected)) {
      await this.env.store.sweeps.schedule(code, now + TIMINGS.DISCONNECT_GRACE_MS);
    }
  }

  /** Une session en erreur ne doit pas empecher les autres d'etre traitees. */
  private async safely(code: string, task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      if (isGameError(error) && error.code === 'SESSION_NOT_FOUND') return;
      this.env.logger.error({ err: error, code }, 'Traitement de session en echec');
    }
  }
}
