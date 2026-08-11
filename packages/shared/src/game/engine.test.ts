import { beforeEach, describe, expect, it } from 'vitest';
import { TIMINGS } from '../constants.js';
import { GameError } from '../errors.js';
import type { Session } from '../types.js';
import {
  addCategory,
  addPlayer,
  advanceCategory,
  advanceReveal,
  applyDeadline,
  backToLobby,
  beginRound,
  castVote,
  createSession,
  ensureHost,
  findExpiredPlayers,
  markConnected,
  markDisconnected,
  maybeCloseVoting,
  nextRound,
  removeCategory,
  removePlayer,
  reorderCategories,
  setAnswer,
  startGame,
  stopRound,
  updateSettings,
} from './engine.js';
import type { EngineDeps } from './engine.js';
import { canTransition } from './stateMachine.js';

/** Horloge et alea deterministes : les tests pilotent le temps a la milliseconde. */
function makeDeps(): EngineDeps & { advance: (ms: number) => void; setNow: (ms: number) => void } {
  let clock = 1_000_000;
  let counter = 0;
  return {
    now: () => clock,
    random: () => 0,
    id: () => `id${(counter += 1)}`,
    advance: (ms: number) => {
      clock += ms;
    },
    setNow: (ms: number) => {
      clock = ms;
    },
  };
}

let deps: ReturnType<typeof makeDeps>;

function newSession(playerCount = 3): Session {
  const session = createSession('ABCDE', { id: 'p1', nickname: 'Alice', tokenHash: 'h1' }, deps);
  const names = ['Bob', 'Chloe', 'David', 'Emma'];
  for (let i = 1; i < playerCount; i += 1) {
    addPlayer(
      session,
      { id: `p${i + 1}`, nickname: names[i - 1] as string, tokenHash: `h${i + 1}` },
      deps,
    );
  }
  return session;
}

/** Amene la session jusqu'a la phase de saisie, avec une seule categorie. */
function startToRound(session: Session, categoryCount = 1): void {
  session.settings.categories = session.settings.categories.slice(0, categoryCount);
  startGame(session, session.hostId, deps);
  deps.advance(TIMINGS.LETTER_DRAW_MS);
  beginRound(session, deps);
}

/** Deroule la revelation complete de la categorie courante. */
function revealAll(session: Session): void {
  while (session.phase === 'reveal') {
    deps.advance(TIMINGS.REVEAL_STEP_MS);
    advanceReveal(session, deps);
  }
}

/** Fait voter tout le monde pour tout le monde, ce qui cloture la categorie. */
function voteAll(session: Session, points: 0 | 1 | 2 = 2): void {
  const round = session.round;
  if (!round) throw new Error('aucune manche');
  for (const voter of round.participants) {
    for (const target of round.participants) {
      if (voter === target) continue;
      if (session.phase !== 'voting') return;
      castVote(session, voter, target, points, deps);
    }
  }
}

beforeEach(() => {
  deps = makeDeps();
});

describe('creation et joueurs', () => {
  it('cree une session en lobby avec un hote', () => {
    const session = newSession(1);
    expect(session.phase).toBe('lobby');
    expect(session.hostId).toBe('p1');
    expect(session.players).toHaveLength(1);
    expect(session.settings.categories.length).toBeGreaterThan(0);
  });

  it('refuse un pseudo deja pris, meme avec une casse differente', () => {
    const session = newSession(1);
    expect(() =>
      addPlayer(session, { id: 'p2', nickname: 'ALICE', tokenHash: 'h2' }, deps),
    ).toThrowError(GameError);
  });

  it('refuse un joueur au-dela de la limite', () => {
    const session = newSession(1);
    for (let i = 2; i <= 16; i += 1) {
      addPlayer(session, { id: `p${i}`, nickname: `J${i}`, tokenHash: `h${i}` }, deps);
    }
    expect(() =>
      addPlayer(session, { id: 'p99', nickname: 'Trop', tokenHash: 'h99' }, deps),
    ).toThrowError(/SESSION_FULL/);
  });

  it('incremente la version a chaque mutation', () => {
    const session = newSession(1);
    const before = session.version;
    addPlayer(session, { id: 'p2', nickname: 'Bob', tokenHash: 'h2' }, deps);
    expect(session.version).toBeGreaterThan(before);
  });
});

describe("transfert du role d'hote", () => {
  it("passe la main au joueur connecte suivant quand l'hote se deconnecte", () => {
    const session = newSession(3);
    markDisconnected(session, 'p1', deps);
    expect(session.hostId).toBe('p2');
  });

  it("passe la main quand l'hote quitte definitivement", () => {
    const session = newSession(3);
    removePlayer(session, 'p1', deps);
    expect(session.hostId).toBe('p2');
  });

  it("ne change pas d'hote si l'hote est toujours connecte", () => {
    const session = newSession(3);
    markDisconnected(session, 'p2', deps);
    expect(session.hostId).toBe('p1');
  });

  it('ne transfere pas le role si personne n est connecte', () => {
    const session = newSession(2);
    markDisconnected(session, 'p1', deps);
    markDisconnected(session, 'p2', deps);
    ensureHost(session);
    expect(['p1', 'p2']).toContain(session.hostId);
  });
});

describe('reconnexion', () => {
  it('remet un joueur en ligne sans perdre son score', () => {
    const session = newSession(2);
    const player = session.players[1];
    if (!player) throw new Error('joueur absent');
    player.totalScore = 7;

    markDisconnected(session, 'p2', deps);
    expect(player.connected).toBe(false);

    deps.advance(5_000);
    markConnected(session, 'p2', deps);
    expect(player.connected).toBe(true);
    expect(player.disconnectedAt).toBeNull();
    expect(player.totalScore).toBe(7);
  });

  it('ne liste comme expire qu apres la fenetre de grace', () => {
    const session = newSession(2);
    markDisconnected(session, 'p2', deps);

    deps.advance(TIMINGS.DISCONNECT_GRACE_MS - 1);
    expect(findExpiredPlayers(session, deps.now())).toEqual([]);

    deps.advance(2);
    expect(findExpiredPlayers(session, deps.now())).toEqual(['p2']);
  });
});

describe('configuration du salon', () => {
  it('refuse un changement de parametres par un non-hote', () => {
    const session = newSession(2);
    expect(() => updateSettings(session, 'p2', { roundCount: 5 }, deps)).toThrowError(/NOT_HOST/);
  });

  it('accepte une manche illimitee', () => {
    const session = newSession(2);
    updateSettings(session, 'p1', { roundDurationSeconds: null }, deps);
    expect(session.settings.roundDurationSeconds).toBeNull();
  });

  it('laisse un joueur ajouter une categorie si le toggle est actif', () => {
    const session = newSession(2);
    const category = addCategory(session, 'p2', 'Jeu video', deps);
    expect(category.addedBy).toBe('p2');
    expect(session.settings.categories.at(-1)?.label).toBe('Jeu video');
  });

  it('bloque les joueurs quand le toggle est desactive', () => {
    const session = newSession(2);
    updateSettings(session, 'p1', { playersCanAddCategories: false }, deps);
    expect(() => addCategory(session, 'p2', 'Jeu video', deps)).toThrowError(/CATEGORIES_LOCKED/);
    expect(() => addCategory(session, 'p1', 'Jeu video', deps)).not.toThrow();
  });

  it('refuse un doublon de categorie insensible aux accents', () => {
    const session = newSession(2);
    addCategory(session, 'p1', 'Cinema', deps);
    expect(() => addCategory(session, 'p2', 'cinéma', deps)).toThrowError(/CATEGORY_DUPLICATE/);
  });

  it('limite le nombre de categories proposees par joueur', () => {
    const session = newSession(2);
    addCategory(session, 'p2', 'Un', deps);
    addCategory(session, 'p2', 'Deux', deps);
    addCategory(session, 'p2', 'Trois', deps);
    expect(() => addCategory(session, 'p2', 'Quatre', deps)).toThrowError(/CATEGORY_LIMIT_REACHED/);
  });

  it('assainit le libelle des categories', () => {
    const session = newSession(1);
    const category = addCategory(session, 'p1', '  <script>Film</script>  ', deps);
    expect(category.label).not.toContain('<');
    expect(category.label).toBe('scriptFilm/script');
  });

  it("n'autorise un joueur a retirer que ses propres categories", () => {
    const session = newSession(2);
    const own = addCategory(session, 'p2', 'Jeu video', deps);
    const hostCategory = session.settings.categories[0];
    if (!hostCategory) throw new Error('categorie absente');

    expect(() => removeCategory(session, 'p2', hostCategory.id, deps)).toThrowError(
      /CATEGORIES_LOCKED/,
    );
    expect(() => removeCategory(session, 'p2', own.id, deps)).not.toThrow();
  });

  it('reordonne les categories et conserve les ajouts concurrents', () => {
    const session = newSession(1);
    session.settings.categories = session.settings.categories.slice(0, 3);
    const [first, second, third] = session.settings.categories;
    if (!first || !second || !third) throw new Error('categories absentes');

    reorderCategories(session, 'p1', [third.id, first.id], deps);
    expect(session.settings.categories.map((category) => category.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
  });

  it('refuse toute configuration une fois la partie lancee', () => {
    const session = newSession(2);
    startToRound(session);
    expect(() => addCategory(session, 'p1', 'Trop tard', deps)).toThrowError(/INVALID_PHASE/);
  });
});

describe('machine a etats', () => {
  it('declare les transitions attendues', () => {
    expect(canTransition('lobby', 'letter_draw')).toBe(true);
    expect(canTransition('letter_draw', 'round_active')).toBe(true);
    expect(canTransition('round_active', 'reveal')).toBe(true);
    expect(canTransition('reveal', 'voting')).toBe(true);
    expect(canTransition('voting', 'category_results')).toBe(true);
    expect(canTransition('category_results', 'reveal')).toBe(true);
    expect(canTransition('category_results', 'round_results')).toBe(true);
    expect(canTransition('round_results', 'letter_draw')).toBe(true);
    expect(canTransition('round_results', 'game_over')).toBe(true);
    expect(canTransition('game_over', 'lobby')).toBe(true);
  });

  it('interdit les raccourcis', () => {
    expect(canTransition('lobby', 'round_active')).toBe(false);
    expect(canTransition('round_active', 'voting')).toBe(false);
    expect(canTransition('game_over', 'round_active')).toBe(false);
  });

  it('refuse de demarrer sans categorie', () => {
    const session = newSession(2);
    session.settings.categories = [];
    expect(() => startGame(session, 'p1', deps)).toThrowError(/NO_CATEGORIES/);
  });

  it('refuse de demarrer pour un non-hote', () => {
    const session = newSession(2);
    expect(() => startGame(session, 'p2', deps)).toThrowError(/NOT_HOST/);
  });

  it('passe par le tirage avant la saisie', () => {
    const session = newSession(2);
    startGame(session, 'p1', deps);
    expect(session.phase).toBe('letter_draw');
    expect(session.deadline?.kind).toBe('letter_draw');

    deps.advance(TIMINGS.LETTER_DRAW_MS);
    beginRound(session, deps);
    expect(session.phase).toBe('round_active');
    expect(session.round?.startedAt).toBe(deps.now());
  });

  it('programme une echeance de fin de manche si une duree est definie', () => {
    const session = newSession(2);
    updateSettings(session, 'p1', { roundDurationSeconds: 60 }, deps);
    startToRound(session);
    expect(session.deadline?.kind).toBe('round_end');
    expect(session.round?.endsAt).toBe(deps.now() + 60_000);
  });

  it('ne programme aucune echeance en manche illimitee', () => {
    const session = newSession(2);
    updateSettings(session, 'p1', { roundDurationSeconds: null }, deps);
    startToRound(session);
    expect(session.deadline).toBeNull();
    expect(session.round?.endsAt).toBeNull();
  });

  it('remet les scores a zero au lancement', () => {
    const session = newSession(2);
    const player = session.players[0];
    if (!player) throw new Error('joueur absent');
    player.totalScore = 42;
    startGame(session, 'p1', deps);
    expect(session.players[0]?.totalScore).toBe(0);
  });
});

describe('saisie et arret de la manche', () => {
  it('enregistre une reponse assainie', () => {
    const session = newSession(2);
    startToRound(session);
    const categoryId = session.round?.categories[0]?.id as string;

    setAnswer(session, 'p1', categoryId, '  <b>Paris</b> ', deps);
    expect(session.round?.answers.p1?.[categoryId]).toBe('bParis/b');
  });

  it('refuse une reponse hors phase de saisie', () => {
    const session = newSession(2);
    const categoryId = session.settings.categories[0]?.id as string;
    expect(() => setAnswer(session, 'p1', categoryId, 'Paris', deps)).toThrowError(/INVALID_PHASE/);
  });

  it('refuse une reponse sur une categorie inconnue', () => {
    const session = newSession(2);
    startToRound(session);
    expect(() => setAnswer(session, 'p1', 'inconnue', 'Paris', deps)).toThrowError(
      /CATEGORY_NOT_FOUND/,
    );
  });

  it("refuse la saisie d'un joueur arrive apres le lancement", () => {
    const session = newSession(2);
    startToRound(session);
    addPlayer(session, { id: 'late', nickname: 'Retard', tokenHash: 'hl' }, deps);
    const categoryId = session.round?.categories[0]?.id as string;

    expect(() => setAnswer(session, 'late', categoryId, 'Paris', deps)).toThrowError(
      /NOT_PARTICIPANT/,
    );
  });

  it('fige les reponses et memorise qui a stoppe', () => {
    const session = newSession(3);
    startToRound(session);
    const categoryId = session.round?.categories[0]?.id as string;
    setAnswer(session, 'p2', categoryId, 'Perou', deps);

    stopRound(session, 'player', 'p2', deps);

    expect(session.phase).toBe('reveal');
    expect(session.round?.stoppedBy).toBe('p2');
    expect(session.round?.stopReason).toBe('player');
    expect(() => setAnswer(session, 'p1', categoryId, 'Trop tard', deps)).toThrowError(
      /INVALID_PHASE/,
    );
  });

  it("n'attribue aucun stoppeur sur une fin au chronometre", () => {
    const session = newSession(2);
    startToRound(session);
    stopRound(session, 'timeout', null, deps);
    expect(session.round?.stoppedBy).toBeNull();
    expect(session.round?.stopReason).toBe('timeout');
  });

  it('refuse un Stop venant d un non-participant', () => {
    const session = newSession(2);
    startToRound(session);
    addPlayer(session, { id: 'late', nickname: 'Retard', tokenHash: 'hl' }, deps);
    expect(() => stopRound(session, 'player', 'late', deps)).toThrowError(/NOT_PARTICIPANT/);
  });
});

describe('revelation', () => {
  it('revele les reponses une par une puis ouvre le vote', () => {
    const session = newSession(3);
    startToRound(session);
    stopRound(session, 'player', 'p1', deps);

    expect(session.round?.revealCursor).toBe(0);
    expect(session.round?.revealOrder).toHaveLength(3);
    expect(session.deadline?.kind).toBe('reveal_step');

    advanceReveal(session, deps);
    expect(session.round?.revealCursor).toBe(1);
    expect(session.phase).toBe('reveal');

    advanceReveal(session, deps);
    advanceReveal(session, deps);
    expect(session.phase).toBe('voting');
  });

  it('saute le vote en mode auto', () => {
    const session = newSession(2);
    updateSettings(session, 'p1', { scoringMode: 'auto' }, deps);
    startToRound(session);
    stopRound(session, 'timeout', null, deps);
    revealAll(session);
    expect(session.phase).toBe('category_results');
  });
});

describe('vote', () => {
  function toVoting(playerCount = 3, categoryCount = 1): Session {
    const session = newSession(playerCount);
    startToRound(session, categoryCount);
    const categoryId = session.round?.categories[0]?.id as string;
    setAnswer(session, 'p1', categoryId, 'Paris', deps);
    setAnswer(session, 'p2', categoryId, 'Perou', deps);
    if (playerCount > 2) setAnswer(session, 'p3', categoryId, 'Prague', deps);
    stopRound(session, 'player', 'p1', deps);
    revealAll(session);
    return session;
  }

  it('refuse de voter pour sa propre reponse', () => {
    const session = toVoting();
    expect(() => castVote(session, 'p1', 'p1', 2, deps)).toThrowError(/CANNOT_VOTE_OWN_ANSWER/);
  });

  it('refuse un vote hors phase de vote', () => {
    const session = newSession(3);
    startToRound(session);
    expect(() => castVote(session, 'p1', 'p2', 2, deps)).toThrowError(/INVALID_PHASE/);
  });

  it('cloture la categorie quand tous les votes sont exprimes', () => {
    const session = toVoting(3);
    // 3 joueurs => 3 cibles x 2 votants = 6 votes attendus.
    castVote(session, 'p1', 'p2', 2, deps);
    castVote(session, 'p1', 'p3', 2, deps);
    castVote(session, 'p2', 'p1', 2, deps);
    castVote(session, 'p2', 'p3', 2, deps);
    castVote(session, 'p3', 'p1', 2, deps);
    expect(session.phase).toBe('voting');

    castVote(session, 'p3', 'p2', 2, deps);
    expect(session.phase).toBe('category_results');
  });

  it('ne bloque pas sur un votant deconnecte', () => {
    const session = toVoting(3);
    castVote(session, 'p1', 'p2', 2, deps);
    castVote(session, 'p1', 'p3', 2, deps);
    castVote(session, 'p2', 'p1', 2, deps);
    castVote(session, 'p2', 'p3', 2, deps);
    expect(session.phase).toBe('voting');

    markDisconnected(session, 'p3', deps);
    expect(maybeCloseVoting(session, deps)).toBe(true);
    expect(session.phase).toBe('category_results');
  });

  it('cloture immediatement le vote dans une partie a un seul joueur', () => {
    const session = newSession(1);
    startToRound(session);
    stopRound(session, 'player', 'p1', deps);
    revealAll(session);
    expect(session.phase).toBe('category_results');
  });
});

describe('scores et enchainement des manches', () => {
  it('cumule les scores de categorie sur la manche', () => {
    const session = newSession(2);
    startToRound(session, 2);
    const [c1, c2] = session.round?.categories ?? [];
    if (!c1 || !c2) throw new Error('categories absentes');
    const letter = session.round?.letter as string;

    setAnswer(session, 'p1', c1.id, `${letter}aris`, deps);
    setAnswer(session, 'p1', c2.id, `${letter}omme`, deps);
    stopRound(session, 'timeout', null, deps);

    // Categorie 1 : p1 unique (2 pts), p2 vide (0 pt).
    revealAll(session);
    castVote(session, 'p2', 'p1', 2, deps);
    castVote(session, 'p1', 'p2', 0, deps);
    expect(session.phase).toBe('category_results');

    advanceCategory(session, deps);
    expect(session.phase).toBe('reveal');
    expect(session.round?.reviewIndex).toBe(1);

    revealAll(session);
    castVote(session, 'p2', 'p1', 2, deps);
    castVote(session, 'p1', 'p2', 0, deps);
    advanceCategory(session, deps);

    expect(session.phase).toBe('round_results');
    expect(session.round?.roundScores.p1).toBe(4);
    expect(session.round?.roundScores.p2).toBe(0);
    expect(session.players[0]?.totalScore).toBe(4);
  });

  it('memorise la lettre jouee et incremente le compteur de manches', () => {
    const session = newSession(1);
    startToRound(session);
    const letter = session.round?.letter as string;
    stopRound(session, 'timeout', null, deps);
    revealAll(session);
    advanceCategory(session, deps);

    expect(session.completedRounds).toBe(1);
    expect(session.usedLetters).toEqual([letter]);
  });

  it('enchaine sur une nouvelle manche avec une nouvelle lettre', () => {
    const session = newSession(1);
    updateSettings(session, 'p1', { roundCount: 2 }, deps);
    startToRound(session);
    stopRound(session, 'timeout', null, deps);
    revealAll(session);
    advanceCategory(session, deps);

    nextRound(session, 'p1', deps);
    expect(session.phase).toBe('letter_draw');
    expect(session.round?.index).toBe(1);
  });

  it('termine la partie apres la derniere manche', () => {
    const session = newSession(1);
    updateSettings(session, 'p1', { roundCount: 1 }, deps);
    startToRound(session);
    stopRound(session, 'timeout', null, deps);
    revealAll(session);
    advanceCategory(session, deps);

    nextRound(session, 'p1', deps);
    expect(session.phase).toBe('game_over');
  });

  it('revient au salon avec les scores remis a zero', () => {
    const session = newSession(2);
    updateSettings(session, 'p1', { roundCount: 1 }, deps);
    startToRound(session);
    stopRound(session, 'timeout', null, deps);
    revealAll(session);
    voteAll(session);
    advanceCategory(session, deps);
    nextRound(session, 'p1', deps);

    backToLobby(session, 'p1', deps);
    expect(session.phase).toBe('lobby');
    expect(session.round).toBeNull();
    expect(session.usedLetters).toEqual([]);
    expect(session.players.every((player) => player.totalScore === 0)).toBe(true);
  });

  it('applique la penalite du stoppeur au score cumule', () => {
    const session = newSession(2);
    startToRound(session, 1);
    stopRound(session, 'player', 'p1', deps);
    revealAll(session);
    castVote(session, 'p2', 'p1', 0, deps);
    castVote(session, 'p1', 'p2', 0, deps);
    advanceCategory(session, deps);

    expect(session.round?.roundScores.p1).toBe(-1);
    expect(session.round?.roundScores.p2).toBe(0);
  });
});

describe('echeances', () => {
  it('rejette une echeance deja consommee (protection multi-instance)', () => {
    const session = newSession(2);
    startGame(session, 'p1', deps);
    const seq = session.deadline?.seq as number;
    deps.advance(TIMINGS.LETTER_DRAW_MS);

    expect(applyDeadline(session, seq, deps)).toBe(true);
    expect(applyDeadline(session, seq, deps)).toBe(false);
    expect(session.phase).toBe('round_active');
  });

  it("n'applique pas une echeance avant son terme", () => {
    const session = newSession(2);
    startGame(session, 'p1', deps);
    expect(applyDeadline(session, session.deadline?.seq as number, deps)).toBe(false);
    expect(session.phase).toBe('letter_draw');
  });

  it('termine la manche au chronometre', () => {
    const session = newSession(2);
    updateSettings(session, 'p1', { roundDurationSeconds: 30 }, deps);
    startToRound(session);

    deps.advance(30_000);
    expect(applyDeadline(session, session.deadline?.seq as number, deps)).toBe(true);
    expect(session.phase).toBe('reveal');
    expect(session.round?.stopReason).toBe('timeout');
  });

  it('cloture le vote quand le minuteur de vote expire', () => {
    const session = newSession(3);
    updateSettings(session, 'p1', { voteDurationSeconds: 10 }, deps);
    startToRound(session);
    stopRound(session, 'player', 'p1', deps);
    revealAll(session);
    expect(session.phase).toBe('voting');

    deps.advance(10_000);
    expect(applyDeadline(session, session.deadline?.seq as number, deps)).toBe(true);
    expect(session.phase).toBe('category_results');
  });
});
