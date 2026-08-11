import { DEFAULT_CATEGORY_LABELS, DEFAULT_LETTER_POOL, LIMITS, TIMINGS } from '../constants.js';
import { GameError } from '../errors.js';
import { normalizeAnswer, sanitizeText } from '../sanitize.js';
import type {
  Category,
  DeadlineKind,
  Round,
  ServerPlayer,
  Session,
  Settings,
  StopReason,
  VotePoints,
} from '../types.js';
import { drawLetter, shuffle } from './letters.js';
import { resolveCategory } from './scoring.js';
import { assertPhase, transition } from './stateMachine.js';

/**
 * Moteur de jeu : fonctions de transition pures appliquees a un objet `Session`.
 * Aucune dependance a Redis, aux sockets ou a l'horloge globale — tout passe par
 * `EngineDeps`, ce qui rend la logique entierement testable.
 *
 * Contrat : chaque mutation passe par une fonction de ce module, qui met a jour
 * `version` / `updatedAt` via `touch()`. La couche reseau se contente de charger,
 * appeler, sauvegarder, diffuser.
 */
export interface EngineDeps {
  now: () => number;
  random: () => number;
  /** Generateur d'identifiants opaques (categories, joueurs). */
  id: () => string;
}

export interface NewPlayerInput {
  id: string;
  nickname: string;
  tokenHash: string;
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                   */
/* -------------------------------------------------------------------------- */

function touch(session: Session, deps: EngineDeps): void {
  session.version += 1;
  session.updatedAt = deps.now();
}

function setDeadline(session: Session, kind: DeadlineKind, at: number): void {
  session.deadlineSeq += 1;
  session.deadline = { kind, at, seq: session.deadlineSeq };
}

function clearDeadline(session: Session): void {
  session.deadline = null;
}

export function findPlayer(session: Session, playerId: string): ServerPlayer | undefined {
  return session.players.find((player) => player.id === playerId);
}

export function requirePlayer(session: Session, playerId: string): ServerPlayer {
  const player = findPlayer(session, playerId);
  if (!player) throw new GameError('NOT_AUTHENTICATED');
  return player;
}

export function isHost(session: Session, playerId: string): boolean {
  return session.hostId === playerId;
}

export function assertHost(session: Session, playerId: string): void {
  if (!isHost(session, playerId)) throw new GameError('NOT_HOST');
}

export function requireRound(session: Session): Round {
  if (!session.round) throw new GameError('INVALID_PHASE', 'Aucune manche en cours');
  return session.round;
}

/** Categorie actuellement revelee / votee. */
export function currentCategory(round: Round): Category | undefined {
  return round.categories[round.reviewIndex];
}

function connectedParticipants(session: Session, round: Round): string[] {
  return round.participants.filter((id) => findPlayer(session, id)?.connected === true);
}

/* -------------------------------------------------------------------------- */
/*                              Creation / joueurs                             */
/* -------------------------------------------------------------------------- */

export function defaultSettings(deps: EngineDeps): Settings {
  return {
    roundDurationSeconds: 120,
    roundCount: 3,
    categories: DEFAULT_CATEGORY_LABELS.map((label) => ({
      id: deps.id(),
      label,
      addedBy: 'host',
    })),
    playersCanAddCategories: true,
    scoringMode: 'hybrid',
    stopperPenalty: true,
    voteDurationSeconds: 30,
    excludeUsedLetters: true,
    letterPool: DEFAULT_LETTER_POOL,
  };
}

export function createSession(code: string, host: NewPlayerInput, deps: EngineDeps): Session {
  const now = deps.now();
  const session: Session = {
    code,
    version: 0,
    phase: 'lobby',
    createdAt: now,
    updatedAt: now,
    hostId: host.id,
    players: [buildPlayer(host, now)],
    settings: defaultSettings(deps),
    usedLetters: [],
    round: null,
    deadline: null,
    deadlineSeq: 0,
    completedRounds: 0,
  };
  return session;
}

function buildPlayer(input: NewPlayerInput, now: number): ServerPlayer {
  return {
    id: input.id,
    nickname: input.nickname,
    tokenHash: input.tokenHash,
    connected: true,
    joinedAt: now,
    lastSeenAt: now,
    disconnectedAt: null,
    ready: false,
    totalScore: 0,
  };
}

export function isNicknameTaken(session: Session, nickname: string, exceptId?: string): boolean {
  const normalized = normalizeAnswer(nickname);
  return session.players.some(
    (player) => player.id !== exceptId && normalizeAnswer(player.nickname) === normalized,
  );
}

export function addPlayer(session: Session, input: NewPlayerInput, deps: EngineDeps): ServerPlayer {
  if (session.players.length >= LIMITS.MAX_PLAYERS) throw new GameError('SESSION_FULL');
  if (isNicknameTaken(session, input.nickname)) throw new GameError('NICKNAME_TAKEN');

  const player = buildPlayer(input, deps.now());
  session.players.push(player);
  touch(session, deps);
  return player;
}

/** Reconnexion d'un joueur connu : on le remet en ligne sans toucher a ses reponses. */
export function markConnected(session: Session, playerId: string, deps: EngineDeps): ServerPlayer {
  const player = requirePlayer(session, playerId);
  player.connected = true;
  player.disconnectedAt = null;
  player.lastSeenAt = deps.now();
  touch(session, deps);
  return player;
}

export function markDisconnected(session: Session, playerId: string, deps: EngineDeps): void {
  const player = findPlayer(session, playerId);
  if (!player || !player.connected) return;
  const now = deps.now();
  player.connected = false;
  player.disconnectedAt = now;
  player.lastSeenAt = now;
  ensureHost(session);
  touch(session, deps);
}

/**
 * Retire definitivement un joueur (depart volontaire ou fenetre de grace ecoulee).
 * Ses reponses de la manche en cours sont conservees : elles ont ete figees au Stop
 * et doivent rester votables.
 */
export function removePlayer(session: Session, playerId: string, deps: EngineDeps): void {
  const index = session.players.findIndex((player) => player.id === playerId);
  if (index === -1) return;
  session.players.splice(index, 1);
  ensureHost(session);
  touch(session, deps);
}

/**
 * Garantit qu'un hote existe : si l'hote est parti ou hors ligne, le role passe au
 * joueur connecte le plus ancien. Sans quoi une partie devient impilotable.
 */
export function ensureHost(session: Session): boolean {
  const current = findPlayer(session, session.hostId);
  if (current?.connected) return false;

  const candidate =
    session.players.find((player) => player.connected) ??
    (current ? undefined : session.players[0]);

  if (!candidate || candidate.id === session.hostId) return false;
  session.hostId = candidate.id;
  return true;
}

export function setReady(
  session: Session,
  playerId: string,
  ready: boolean,
  deps: EngineDeps,
): void {
  assertPhase(session, ['lobby']);
  const player = requirePlayer(session, playerId);
  player.ready = ready;
  touch(session, deps);
}

/** Joueurs dont la fenetre de reconnexion est ecoulee. */
export function findExpiredPlayers(session: Session, now: number): string[] {
  return session.players
    .filter(
      (player) =>
        !player.connected &&
        player.disconnectedAt !== null &&
        now - player.disconnectedAt > TIMINGS.DISCONNECT_GRACE_MS,
    )
    .map((player) => player.id);
}

/* -------------------------------------------------------------------------- */
/*                            Configuration (lobby)                            */
/* -------------------------------------------------------------------------- */

export type SettingsPatch = Partial<Omit<Settings, 'categories'>>;

export function updateSettings(
  session: Session,
  playerId: string,
  patch: SettingsPatch,
  deps: EngineDeps,
): void {
  assertPhase(session, ['lobby']);
  assertHost(session, playerId);
  session.settings = { ...session.settings, ...patch };
  touch(session, deps);
}

function assertCanEditCategories(session: Session, playerId: string): void {
  if (isHost(session, playerId)) return;
  if (!session.settings.playersCanAddCategories) throw new GameError('CATEGORIES_LOCKED');
}

export function addCategory(
  session: Session,
  playerId: string,
  label: string,
  deps: EngineDeps,
): Category {
  assertPhase(session, ['lobby']);
  assertCanEditCategories(session, playerId);

  const clean = sanitizeText(label, LIMITS.CATEGORY_MAX);
  if (clean.length < LIMITS.CATEGORY_MIN) throw new GameError('INVALID_PAYLOAD');

  const { categories } = session.settings;
  if (categories.length >= LIMITS.MAX_CATEGORIES) throw new GameError('CATEGORY_LIMIT_REACHED');

  const normalized = normalizeAnswer(clean);
  if (categories.some((category) => normalizeAnswer(category.label) === normalized)) {
    throw new GameError('CATEGORY_DUPLICATE');
  }

  if (!isHost(session, playerId)) {
    const own = categories.filter((category) => category.addedBy === playerId).length;
    if (own >= LIMITS.MAX_CATEGORIES_PER_PLAYER) throw new GameError('CATEGORY_LIMIT_REACHED');
  }

  const category: Category = { id: deps.id(), label: clean, addedBy: playerId };
  categories.push(category);
  touch(session, deps);
  return category;
}

export function removeCategory(
  session: Session,
  playerId: string,
  categoryId: string,
  deps: EngineDeps,
): void {
  assertPhase(session, ['lobby']);
  const { categories } = session.settings;
  const category = categories.find((item) => item.id === categoryId);
  if (!category) throw new GameError('CATEGORY_NOT_FOUND');

  // Un joueur ne peut retirer que les categories qu'il a lui-meme proposees.
  if (!isHost(session, playerId) && category.addedBy !== playerId) {
    throw new GameError('CATEGORIES_LOCKED');
  }

  session.settings.categories = categories.filter((item) => item.id !== categoryId);
  touch(session, deps);
}

export function reorderCategories(
  session: Session,
  playerId: string,
  orderedIds: string[],
  deps: EngineDeps,
): void {
  assertPhase(session, ['lobby']);
  assertHost(session, playerId);

  const byId = new Map(session.settings.categories.map((category) => [category.id, category]));
  const reordered: Category[] = [];
  for (const id of orderedIds) {
    const category = byId.get(id);
    if (!category) continue;
    byId.delete(id);
    reordered.push(category);
  }
  // Les categories absentes de la liste envoyee (ajout concurrent) restent a la fin.
  reordered.push(...byId.values());

  session.settings.categories = reordered;
  touch(session, deps);
}

/* -------------------------------------------------------------------------- */
/*                              Deroule d'une manche                           */
/* -------------------------------------------------------------------------- */

export function startGame(session: Session, playerId: string, deps: EngineDeps): void {
  assertPhase(session, ['lobby']);
  assertHost(session, playerId);
  if (session.settings.categories.length < LIMITS.MIN_CATEGORIES) {
    throw new GameError('NO_CATEGORIES');
  }
  session.completedRounds = 0;
  session.usedLetters = [];
  for (const player of session.players) {
    player.totalScore = 0;
    player.ready = false;
  }
  beginLetterDraw(session, deps);
}

/** Tirage de la lettre : phase d'animation, aucune saisie possible. */
export function beginLetterDraw(session: Session, deps: EngineDeps): void {
  transition(session, 'letter_draw');
  const now = deps.now();
  const letter = drawLetter(
    session.settings.letterPool,
    session.usedLetters,
    session.settings.excludeUsedLetters,
    deps.random,
  );

  const participants = session.players.map((player) => player.id);
  const answers: Round['answers'] = {};
  for (const id of participants) answers[id] = {};

  session.round = {
    index: session.completedRounds,
    letter,
    startedAt: null,
    endsAt: null,
    stoppedAt: null,
    stoppedBy: null,
    stopReason: null,
    categories: session.settings.categories.map((category) => ({ ...category })),
    participants,
    answers,
    votes: {},
    resolved: {},
    reviewIndex: 0,
    revealCursor: 0,
    revealOrder: [],
    roundScores: Object.fromEntries(participants.map((id) => [id, 0])),
  };

  setDeadline(session, 'letter_draw', now + TIMINGS.LETTER_DRAW_MS);
  touch(session, deps);
}

/** Fin de l'animation de tirage : la manche demarre reellement. */
export function beginRound(session: Session, deps: EngineDeps): void {
  assertPhase(session, ['letter_draw']);
  const round = requireRound(session);
  const now = deps.now();

  transition(session, 'round_active');
  round.startedAt = now;

  const duration = session.settings.roundDurationSeconds;
  if (duration && duration > 0) {
    round.endsAt = now + duration * 1000;
    setDeadline(session, 'round_end', round.endsAt);
  } else {
    round.endsAt = null;
    clearDeadline(session);
  }
  touch(session, deps);
}

export function setAnswer(
  session: Session,
  playerId: string,
  categoryId: string,
  value: string,
  deps: EngineDeps,
): void {
  assertPhase(session, ['round_active']);
  const round = requireRound(session);
  if (!round.participants.includes(playerId)) throw new GameError('NOT_PARTICIPANT');
  if (!round.categories.some((category) => category.id === categoryId)) {
    throw new GameError('CATEGORY_NOT_FOUND');
  }

  const clean = sanitizeText(value, LIMITS.ANSWER_MAX);
  const playerAnswers = round.answers[playerId] ?? {};
  playerAnswers[categoryId] = clean;
  round.answers[playerId] = playerAnswers;

  // Pas de `touch()` : les saisies sont frequentes et privees. La diffusion se
  // limite au compteur de champs remplis, gere par la couche reseau.
  session.updatedAt = deps.now();
}

/**
 * Arret de la manche : soit un joueur clique sur Stop, soit le chronometre expire.
 * Les reponses sont figees telles quelles a cet instant.
 */
export function stopRound(
  session: Session,
  reason: StopReason,
  byPlayerId: string | null,
  deps: EngineDeps,
): void {
  assertPhase(session, ['round_active']);
  const round = requireRound(session);

  if (reason === 'player') {
    if (!byPlayerId || !round.participants.includes(byPlayerId)) {
      throw new GameError('NOT_PARTICIPANT');
    }
  }

  round.stoppedAt = deps.now();
  round.stoppedBy = reason === 'player' ? byPlayerId : null;
  round.stopReason = reason;
  round.reviewIndex = 0;

  transition(session, 'reveal');
  startCategoryReveal(session, deps);
  touch(session, deps);
}

/** Prepare la revelation de la categorie courante (ordre aleatoire des joueurs). */
function startCategoryReveal(session: Session, deps: EngineDeps): void {
  const round = requireRound(session);
  round.revealCursor = 0;
  round.revealOrder = shuffle(round.participants, deps.random);
  setDeadline(session, 'reveal_step', deps.now() + TIMINGS.REVEAL_STEP_MS);
}

/**
 * Avance d'un cran la revelation. Retourne `true` tant qu'il reste des reponses a
 * montrer, `false` quand la categorie passe au vote (ou directement aux scores).
 */
export function advanceReveal(session: Session, deps: EngineDeps): boolean {
  assertPhase(session, ['reveal']);
  const round = requireRound(session);

  if (round.revealCursor < round.revealOrder.length) {
    round.revealCursor += 1;
  }

  if (round.revealCursor < round.revealOrder.length) {
    setDeadline(session, 'reveal_step', deps.now() + TIMINGS.REVEAL_STEP_MS);
    touch(session, deps);
    return true;
  }

  openVoting(session, deps);
  return false;
}

/** Ouvre le vote de la categorie courante, ou saute directement au calcul. */
export function openVoting(session: Session, deps: EngineDeps): void {
  const round = requireRound(session);

  if (session.settings.scoringMode === 'auto') {
    transition(session, 'category_results');
    closeCategory(session, deps);
    return;
  }

  transition(session, 'voting');

  const duration = session.settings.voteDurationSeconds;
  if (duration && duration > 0) {
    setDeadline(session, 'vote_end', deps.now() + duration * 1000);
  } else {
    clearDeadline(session);
  }
  touch(session, deps);

  // Partie a un seul joueur (ou tous les autres hors ligne) : aucun vote attendu.
  if (expectedVoteCount(session, round) === 0) {
    closeCategory(session, deps);
  }
}

/** Nombre de votes attendus pour la categorie courante (votants connectes seulement). */
export function expectedVoteCount(session: Session, round: Round): number {
  const voters = connectedParticipants(session, round);
  let expected = 0;
  for (const target of round.participants) {
    expected += voters.filter((voter) => voter !== target).length;
  }
  return expected;
}

/** Nombre de votes reellement exprimes pour la categorie courante. */
export function castVoteCount(round: Round): number {
  const category = currentCategory(round);
  if (!category) return 0;
  const forCategory = round.votes[category.id] ?? {};
  return Object.values(forCategory).reduce(
    (total, byVoter) => total + Object.keys(byVoter).length,
    0,
  );
}

/** Joueurs ayant termine de voter pour toutes les reponses de la categorie courante. */
export function votersDone(session: Session, round: Round): string[] {
  const category = currentCategory(round);
  if (!category) return [];
  const forCategory = round.votes[category.id] ?? {};
  const targets = round.participants;

  return connectedParticipants(session, round).filter((voter) => {
    const required = targets.filter((target) => target !== voter);
    return required.every((target) => forCategory[target]?.[voter] !== undefined);
  });
}

export function castVote(
  session: Session,
  voterId: string,
  targetId: string,
  points: VotePoints,
  deps: EngineDeps,
): void {
  assertPhase(session, ['voting']);
  const round = requireRound(session);
  const category = currentCategory(round);
  if (!category) throw new GameError('VOTE_NOT_OPEN');

  if (!round.participants.includes(voterId)) throw new GameError('NOT_PARTICIPANT');
  if (!round.participants.includes(targetId)) throw new GameError('NOT_PARTICIPANT');
  if (voterId === targetId) throw new GameError('CANNOT_VOTE_OWN_ANSWER');

  const forCategory = round.votes[category.id] ?? {};
  const forTarget = forCategory[targetId] ?? {};
  forTarget[voterId] = points;
  forCategory[targetId] = forTarget;
  round.votes[category.id] = forCategory;
  touch(session, deps);

  if (castVoteCount(round) >= expectedVoteCount(session, round)) {
    closeCategory(session, deps);
  }
}

/** Calcule et fige le score de la categorie courante. */
export function closeCategory(session: Session, deps: EngineDeps): void {
  const round = requireRound(session);
  const category = currentCategory(round);
  if (!category) return;

  const answers: Record<string, string | undefined> = {};
  for (const playerId of round.participants) {
    answers[playerId] = round.answers[playerId]?.[category.id];
  }

  const resolved = resolveCategory({
    participants: round.participants,
    answers,
    votes: round.votes[category.id] ?? {},
    letter: round.letter,
    scoringMode: session.settings.scoringMode,
    stopperId: round.stoppedBy,
    stopReason: round.stopReason,
    stopperPenalty: session.settings.stopperPenalty,
  });

  round.resolved[category.id] = resolved;
  for (const [playerId, score] of Object.entries(resolved)) {
    round.roundScores[playerId] = (round.roundScores[playerId] ?? 0) + score.points;
  }

  transition(session, 'category_results');
  setDeadline(session, 'category_results', deps.now() + TIMINGS.CATEGORY_RESULTS_MS);
  touch(session, deps);
}

/**
 * Passe a la categorie suivante, ou termine la manche s'il n'en reste plus.
 * Retourne `true` si une nouvelle categorie demarre.
 */
export function advanceCategory(session: Session, deps: EngineDeps): boolean {
  assertPhase(session, ['category_results']);
  const round = requireRound(session);

  if (round.reviewIndex + 1 < round.categories.length) {
    round.reviewIndex += 1;
    transition(session, 'reveal');
    startCategoryReveal(session, deps);
    touch(session, deps);
    return true;
  }

  finishRound(session, deps);
  return false;
}

/** Cloture la manche : report des scores sur les totaux, memorisation de la lettre. */
export function finishRound(session: Session, deps: EngineDeps): void {
  const round = requireRound(session);

  for (const player of session.players) {
    player.totalScore += round.roundScores[player.id] ?? 0;
  }

  session.usedLetters.push(round.letter);
  session.completedRounds += 1;

  transition(session, 'round_results');
  clearDeadline(session);
  touch(session, deps);
}

export function hasMoreRounds(session: Session): boolean {
  return session.completedRounds < session.settings.roundCount;
}

/** Manche suivante (meme parametrage) ou ecran de classement final. */
export function nextRound(session: Session, playerId: string, deps: EngineDeps): void {
  assertPhase(session, ['round_results']);
  assertHost(session, playerId);

  if (!hasMoreRounds(session)) {
    endGame(session, deps);
    return;
  }
  beginLetterDraw(session, deps);
}

export function endGame(session: Session, deps: EngineDeps): void {
  transition(session, 'game_over');
  clearDeadline(session);
  touch(session, deps);
}

/** Retour au salon depuis l'ecran final : on rejoue avec les memes joueurs. */
export function backToLobby(session: Session, playerId: string, deps: EngineDeps): void {
  assertPhase(session, ['game_over']);
  assertHost(session, playerId);

  transition(session, 'lobby');
  session.round = null;
  session.usedLetters = [];
  session.completedRounds = 0;
  for (const player of session.players) {
    player.totalScore = 0;
    player.ready = false;
  }
  clearDeadline(session);
  touch(session, deps);
}

/**
 * Interruption de la partie (plus aucun joueur connecte, ou abandon demande par
 * l'hote) : retour au salon depuis n'importe quelle phase.
 */
export function abortToLobby(session: Session, deps: EngineDeps): void {
  if (session.phase === 'lobby') return;
  transition(session, 'lobby');
  session.round = null;
  clearDeadline(session);
  touch(session, deps);
}

/**
 * Recalcule la completion du vote apres un changement d'effectif : un votant qui
 * se deconnecte ne doit pas bloquer indefiniment la categorie.
 */
export function maybeCloseVoting(session: Session, deps: EngineDeps): boolean {
  if (session.phase !== 'voting' || !session.round) return false;
  const round = session.round;
  if (castVoteCount(round) < expectedVoteCount(session, round)) return false;
  closeCategory(session, deps);
  return true;
}

/* -------------------------------------------------------------------------- */
/*                          Traitement des echeances                           */
/* -------------------------------------------------------------------------- */

/**
 * Applique l'echeance arrivee a terme. Le `seq` garantit qu'une echeance deja
 * consommee par une autre instance n'est pas rejouee.
 */
export function applyDeadline(session: Session, seq: number, deps: EngineDeps): boolean {
  const deadline = session.deadline;
  if (!deadline || deadline.seq !== seq) return false;
  if (deps.now() < deadline.at) return false;

  clearDeadline(session);

  switch (deadline.kind) {
    case 'letter_draw':
      beginRound(session, deps);
      return true;
    case 'round_end':
      stopRound(session, 'timeout', null, deps);
      return true;
    case 'reveal_step':
      advanceReveal(session, deps);
      return true;
    case 'vote_end':
      closeCategory(session, deps);
      return true;
    case 'category_results':
      advanceCategory(session, deps);
      return true;
    default:
      return false;
  }
}
