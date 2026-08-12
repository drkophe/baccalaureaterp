import { describe, expect, it } from 'vitest';
import {
  buildScoreboard,
  computeAutoScore,
  eligibleVoters,
  resolveCategory,
  resolveVotes,
  tallyVotes,
} from './scoring';
import type { CategoryScoringInput } from './scoring';
import type { VotePoints } from '../shared/types';

const baseInput = (overrides: Partial<CategoryScoringInput> = {}): CategoryScoringInput => ({
  participants: ['a', 'b', 'c'],
  answers: {},
  votes: {},
  letter: 'P',
  scoringMode: 'auto',
  stopperId: null,
  stopReason: null,
  stopperPenalty: true,
  ...overrides,
});

describe('computeAutoScore', () => {
  const participants = ['a', 'b', 'c'];

  it('donne 2 points a une reponse unique et valide', () => {
    const answers = { a: 'Portugal', b: 'Perou', c: 'Pologne' };
    expect(computeAutoScore('a', answers, participants, 'P').base).toBe(2);
  });

  it('donne 1 point a une reponse partagee', () => {
    const answers = { a: 'Portugal', b: 'portugal', c: 'Pologne' };
    const result = computeAutoScore('a', answers, participants, 'P');
    expect(result.base).toBe(1);
    expect(result.duplicateWith).toEqual(['b']);
  });

  it('ignore accents et ponctuation dans la detection des doublons', () => {
    const answers = { a: 'Perou', b: 'Pérou !', c: '' };
    expect(computeAutoScore('a', answers, participants, 'P').base).toBe(1);
  });

  it('donne 0 a une reponse vide', () => {
    const answers = { a: '   ', b: 'Perou', c: 'Pologne' };
    const result = computeAutoScore('a', answers, participants, 'P');
    expect(result.base).toBe(0);
    expect(result.empty).toBe(true);
  });

  it('donne 0 a une reponse qui ne commence pas par la lettre', () => {
    const answers = { a: 'Bresil', b: 'Perou', c: 'Pologne' };
    const result = computeAutoScore('a', answers, participants, 'P');
    expect(result.base).toBe(0);
    expect(result.empty).toBe(false);
  });

  it('ne considere pas comme doublon une reponse invalide identique', () => {
    // Les deux ont repondu "Bresil" sur la lettre P : les deux sont a 0, pas a 1.
    const answers = { a: 'Bresil', b: 'Bresil', c: 'Pologne' };
    expect(computeAutoScore('a', answers, participants, 'P').duplicateWith).toEqual([]);
  });

  it('accepte une reponse accentuee commencant par la lettre tiree', () => {
    const answers = { a: 'Éléphant', b: '', c: '' };
    expect(computeAutoScore('a', answers, ['a', 'b', 'c'], 'E').base).toBe(2);
  });
});

describe('resolveVotes', () => {
  it('retourne null sans vote exprime', () => {
    expect(resolveVotes([])).toBeNull();
  });

  it('prend la mediane sur un nombre impair de votes', () => {
    expect(resolveVotes([0, 2, 2])).toBe(2);
    expect(resolveVotes([0, 0, 2])).toBe(0);
  });

  it('arrondit vers le haut sur une mediane a .5', () => {
    expect(resolveVotes([0, 1])).toBe(1);
    expect(resolveVotes([1, 2])).toBe(2);
  });

  it('resiste a un vote isole malveillant', () => {
    const votes: VotePoints[] = [2, 2, 2, 0];
    expect(resolveVotes(votes)).toBe(2);
  });

  it('tranche au milieu sur un vote parfaitement partage', () => {
    expect(resolveVotes([0, 0, 2, 2])).toBe(1);
  });
});

describe('tallyVotes', () => {
  it('compte les votes par valeur', () => {
    expect(tallyVotes([0, 1, 1, 2])).toEqual([1, 2, 1]);
  });
});

describe('eligibleVoters', () => {
  it("exclut l'auteur de la reponse", () => {
    expect(eligibleVoters(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});

describe('resolveCategory - mode auto', () => {
  it('applique la regle classique et ignore les votes', () => {
    const result = resolveCategory(
      baseInput({
        answers: { a: 'Paris', b: 'Paris', c: 'Prague' },
        votes: { a: { b: 0, c: 0 } },
      }),
    );
    expect(result.a?.points).toBe(1);
    expect(result.b?.points).toBe(1);
    expect(result.c?.points).toBe(2);
  });
});

describe('resolveCategory - mode vote', () => {
  it('fait foi du vote des joueurs', () => {
    const result = resolveCategory(
      baseInput({
        scoringMode: 'vote',
        answers: { a: 'Prague', b: 'Perou', c: 'Pologne' },
        votes: { a: { b: 0, c: 0 } },
      }),
    );
    expect(result.a?.points).toBe(0);
    expect(result.a?.voteTally).toEqual([2, 0, 0]);
  });

  it('ignore les votes de non-participants', () => {
    const result = resolveCategory(
      baseInput({
        scoringMode: 'vote',
        answers: { a: 'Prague', b: '', c: '' },
        votes: { a: { intrus: 0, b: 2, c: 2 } },
      }),
    );
    expect(result.a?.points).toBe(2);
    expect(result.a?.voteTally).toEqual([0, 0, 2]);
  });

  it("ignore l'auto-vote", () => {
    const result = resolveCategory(
      baseInput({
        scoringMode: 'vote',
        answers: { a: 'Prague', b: '', c: '' },
        votes: { a: { a: 2 } },
      }),
    );
    // Aucun vote eligible : repli sur la regle automatique.
    expect(result.a?.voteTally).toEqual([0, 0, 0]);
    expect(result.a?.points).toBe(2);
  });

  it('se replie sur la note automatique quand personne ne vote', () => {
    const result = resolveCategory(
      baseInput({
        scoringMode: 'vote',
        answers: { a: 'Paris', b: 'Paris', c: 'Prague' },
      }),
    );
    expect(result.a?.points).toBe(1);
    expect(result.c?.points).toBe(2);
  });

  it('fonctionne avec un seul joueur (aucun votant possible)', () => {
    const result = resolveCategory(
      baseInput({
        participants: ['solo'],
        scoringMode: 'vote',
        answers: { solo: 'Portugal' },
      }),
    );
    expect(result.solo?.points).toBe(2);
  });
});

describe('resolveCategory - penalite du joueur qui stoppe', () => {
  it('transforme un 0 en -1 pour le joueur ayant stoppe la manche', () => {
    const result = resolveCategory(
      baseInput({
        scoringMode: 'vote',
        answers: { a: 'Xylophone', b: 'Perou', c: 'Pologne' },
        votes: { a: { b: 0, c: 0 } },
        stopperId: 'a',
        stopReason: 'player',
      }),
    );
    expect(result.a?.points).toBe(-1);
    expect(result.a?.penalty).toBe(true);
    expect(result.a?.base).toBe(0);
  });

  it("n'applique la penalite qu'au joueur qui a stoppe", () => {
    const result = resolveCategory(
      baseInput({
        answers: { a: '', b: '', c: 'Pologne' },
        stopperId: 'a',
        stopReason: 'player',
      }),
    );
    expect(result.a?.points).toBe(-1);
    expect(result.b?.points).toBe(0);
    expect(result.b?.penalty).toBe(false);
  });

  it("n'applique pas la penalite quand la manche finit au chronometre", () => {
    const result = resolveCategory(
      baseInput({
        answers: { a: '', b: 'Perou', c: 'Pologne' },
        stopperId: null,
        stopReason: 'timeout',
      }),
    );
    expect(result.a?.points).toBe(0);
    expect(result.a?.penalty).toBe(false);
  });

  it('ne penalise pas une reponse du stoppeur jugee valable', () => {
    const result = resolveCategory(
      baseInput({
        answers: { a: 'Portugal', b: 'Perou', c: 'Pologne' },
        stopperId: 'a',
        stopReason: 'player',
      }),
    );
    expect(result.a?.points).toBe(2);
  });

  it('peut etre desactivee par le parametrage', () => {
    const result = resolveCategory(
      baseInput({
        answers: { a: '', b: 'Perou', c: 'Pologne' },
        stopperId: 'a',
        stopReason: 'player',
        stopperPenalty: false,
      }),
    );
    expect(result.a?.points).toBe(0);
  });
});

describe('resolveCategory - mode hybride', () => {
  it('laisse les votes ecraser la proposition automatique', () => {
    // "Paris" est en double (proposition auto = 1), mais les joueurs valident a 2.
    const result = resolveCategory(
      baseInput({
        scoringMode: 'hybrid',
        answers: { a: 'Paris', b: 'Paris', c: 'Prague' },
        votes: { a: { b: 2, c: 2 } },
      }),
    );
    expect(result.a?.points).toBe(2);
    expect(result.a?.duplicateWith).toEqual(['b']);
  });

  it('conserve la proposition automatique sans vote exprime', () => {
    const result = resolveCategory(
      baseInput({
        scoringMode: 'hybrid',
        answers: { a: 'Paris', b: 'Paris', c: 'Prague' },
      }),
    );
    expect(result.a?.points).toBe(1);
  });
});

describe('buildScoreboard', () => {
  it('classe par score decroissant', () => {
    const board = buildScoreboard([
      { id: 'a', nickname: 'Alice', totalScore: 4 },
      { id: 'b', nickname: 'Bob', totalScore: 9 },
      { id: 'c', nickname: 'Chloe', totalScore: 6 },
    ]);
    expect(board.map((entry) => entry.playerId)).toEqual(['b', 'c', 'a']);
    expect(board[0]?.rank).toBe(1);
  });

  it('partage le rang entre ex aequo et saute le suivant', () => {
    const board = buildScoreboard([
      { id: 'a', nickname: 'Alice', totalScore: 5 },
      { id: 'b', nickname: 'Bob', totalScore: 5 },
      { id: 'c', nickname: 'Chloe', totalScore: 1 },
    ]);
    expect(board.map((entry) => entry.rank)).toEqual([1, 1, 3]);
  });

  it('gere les scores negatifs', () => {
    const board = buildScoreboard([
      { id: 'a', nickname: 'Alice', totalScore: -2 },
      { id: 'b', nickname: 'Bob', totalScore: 0 },
    ]);
    expect(board[0]?.playerId).toBe('b');
  });
});
