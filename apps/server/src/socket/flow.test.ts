import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientSession } from '@bacc/shared';
import {
  closeClients,
  connectClient,
  createSessionOverHttp,
  join,
  startTestServer,
  waitForEvent,
  waitForState,
  type TestClient,
  type TestServer,
} from '../test/harness.js';

/**
 * Tests d'integration de la couche reseau : on parle au serveur comme un vrai
 * navigateur (HTTP + WebSocket), sans court-circuiter le moteur ni le store.
 */
let server: TestServer;
const clients: TestClient[] = [];

function client(): TestClient {
  const socket = connectClient(server.url);
  clients.push(socket);
  return socket;
}

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  closeClients(...clients.splice(0));
  await server.close();
});

describe('creation et arrivee dans une partie', () => {
  it('cree une partie via HTTP et la rejoint via socket', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    expect(code).toHaveLength(5);

    const alice = client();
    const result = await join(alice, {
      code,
      nickname: 'Alice',
      playerId: host.playerId,
      token: host.token,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.phase).toBe('lobby');
    expect(result.session.players).toHaveLength(1);
    expect(result.token).toBeTruthy();
  });

  it('refuse un pseudo vide', async () => {
    const response = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: '   ' }),
    });
    expect(response.status).toBe(400);
  });

  it('refuse un code de partie inexistant', async () => {
    const result = await join(client(), { code: 'ZZZZZ', nickname: 'Perdu' });
    expect(result).toMatchObject({ ok: false, code: 'SESSION_NOT_FOUND' });
  });

  it('refuse un pseudo deja pris', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    await join(client(), { code, nickname: 'Alice', playerId: host.playerId, token: host.token });
    const result = await join(client(), { code, nickname: 'alice' });
    expect(result).toMatchObject({ ok: false, code: 'NICKNAME_TAKEN' });
  });

  it('previent les autres joueurs de l arrivee', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const alice = client();
    await join(alice, { code, nickname: 'Alice', playerId: host.playerId, token: host.token });

    const arrival = waitForEvent(alice, 'player:joined');
    await join(client(), { code, nickname: 'Bob' });

    expect((await arrival).nickname).toBe('Bob');
  });

  it('rejette un payload malforme sans tuer la connexion', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const alice = client();
    await join(alice, { code, nickname: 'Alice', playerId: host.playerId, token: host.token });

    const error = waitForEvent(alice, 'error');
    // Payload volontairement invalide (aucun champ attendu).
    alice.emit('category:add', { label: '' } as never);

    expect((await error).code).toBe('INVALID_PAYLOAD');
    expect(alice.connected).toBe(true);
  });
});

describe('reconnexion', () => {
  it('retrouve sa place avec son identifiant et son token', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const first = client();
    const joined = await join(first, {
      code,
      nickname: 'Alice',
      playerId: host.playerId,
      token: host.token,
    });
    if (!joined.ok) throw new Error('join en echec');

    first.close();

    const second = client();
    const again = await join(second, {
      code,
      nickname: 'Alice',
      playerId: joined.playerId,
      token: joined.token,
    });

    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.playerId).toBe(joined.playerId);
    expect(again.session.players).toHaveLength(1);
  });

  it('refuse une reprise de session avec un mauvais token', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const joined = await join(client(), {
      code,
      nickname: 'Alice',
      playerId: host.playerId,
      token: host.token,
    });
    if (!joined.ok) throw new Error('join en echec');

    const result = await join(client(), {
      code,
      nickname: 'Alice',
      playerId: joined.playerId,
      token: 'x'.repeat(32),
    });
    expect(result).toMatchObject({ ok: false, code: 'NOT_AUTHENTICATED' });
  });
});

describe('configuration du salon', () => {
  it('diffuse les changements de parametres a tout le monde', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const alice = client();
    const bob = client();
    await join(alice, { code, nickname: 'Alice', playerId: host.playerId, token: host.token });
    await join(bob, { code, nickname: 'Bob' });

    const updated = waitForState(bob, (session) => session.settings.roundCount === 5);
    alice.emit('settings:update', { roundCount: 5 });

    expect((await updated).settings.roundCount).toBe(5);
  });

  it("refuse un changement de parametres venant d'un joueur", async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const alice = client();
    const bob = client();
    await join(alice, { code, nickname: 'Alice', playerId: host.playerId, token: host.token });
    await join(bob, { code, nickname: 'Bob' });

    const error = waitForEvent(bob, 'error');
    bob.emit('settings:update', { roundCount: 5 });

    expect((await error).code).toBe('NOT_HOST');
  });

  it('laisse un joueur proposer une categorie quand le toggle est actif', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const alice = client();
    const bob = client();
    await join(alice, { code, nickname: 'Alice', playerId: host.playerId, token: host.token });
    await join(bob, { code, nickname: 'Bob' });

    const updated = waitForState(alice, (session) =>
      session.settings.categories.some((category) => category.label === 'Jeu video'),
    );
    bob.emit('category:add', { label: 'Jeu video' });
    await updated;
  });
});

describe('deroule complet d une manche', () => {
  it('tire une lettre, fige les reponses au Stop, revele puis fait voter', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const alice = client();
    const bob = client();
    const aliceJoin = await join(alice, {
      code,
      nickname: 'Alice',
      playerId: host.playerId,
      token: host.token,
    });
    await join(bob, { code, nickname: 'Bob' });
    if (!aliceJoin.ok) throw new Error('join en echec');

    // Une seule categorie et une seule manche pour garder le test court.
    // L'accuse de reception du join porte deja l'etat : l'attendre a nouveau
    // exposerait le test a une diffusion arrivee avant l'ecoute.
    const lobby = aliceJoin.session;
    const keep = lobby.settings.categories[0];
    if (!keep) throw new Error('categorie absente');
    for (const category of lobby.settings.categories.slice(1)) {
      alice.emit('category:remove', { categoryId: category.id });
    }
    await waitForState(alice, (session) => session.settings.categories.length === 1);
    alice.emit('settings:update', { roundCount: 1, roundDurationSeconds: null });
    await waitForState(alice, (session) => session.settings.roundCount === 1);

    // La lettre reste secrete pendant l'animation de tirage.
    const drawing = waitForState(alice, (session) => session.phase === 'letter_draw');
    alice.emit('game:start');
    expect((await drawing).round?.letter).toBe('');

    const letterEvent = waitForEvent(alice, 'round:letter');
    const active = await waitForState(alice, (session) => session.phase === 'round_active');
    const letter = (await letterEvent).letter;
    expect(letter).toHaveLength(1);
    expect(active.round?.letter).toBe(letter);

    // Alice repond, Bob non.
    const progress = waitForEvent(bob, 'round:progress');
    alice.emit('round:answer', { categoryId: keep.id, value: `${letter}rmoire` });
    expect((await progress).filledCounts[aliceJoin.playerId]).toBe(1);

    // Bob coupe la manche sans avoir rien rempli.
    const stopped = waitForEvent(alice, 'round:stopped');
    bob.emit('round:stop');
    const stopInfo = await stopped;
    expect(stopInfo.reason).toBe('player');
    expect(stopInfo.byNickname).toBe('Bob');

    // Pendant la revelation, Alice ne voit d'abord que ses propres reponses.
    const voting = await waitForState(alice, (session) => session.phase === 'voting');
    expect(voting.round?.answers[aliceJoin.playerId]?.[keep.id]).toBe(`${letter}rmoire`);

    const results = waitForState(alice, (session) => session.phase === 'category_results');
    alice.emit('vote:cast', { categoryId: keep.id, targetPlayerId: bobIdOf(voting), points: 0 });
    bob.emit('vote:cast', { categoryId: keep.id, targetPlayerId: aliceJoin.playerId, points: 2 });

    const scored = await results;
    const resolvedForCategory = scored.round?.resolved[keep.id];
    expect(resolvedForCategory?.[aliceJoin.playerId]?.points).toBe(2);
    // Bob a stoppe la manche avec une reponse vide : -1 au lieu de 0.
    expect(resolvedForCategory?.[bobIdOf(voting)]?.points).toBe(-1);
    expect(resolvedForCategory?.[bobIdOf(voting)]?.penalty).toBe(true);

    const finished = await waitForState(alice, (session) => session.phase === 'round_results');
    expect(finished.players.find((player) => player.nickname === 'Alice')?.totalScore).toBe(2);
    expect(finished.players.find((player) => player.nickname === 'Bob')?.totalScore).toBe(-1);

    const over = waitForState(alice, (session) => session.phase === 'game_over');
    alice.emit('round:next');
    await over;
  }, 30_000);

  it("empeche un joueur d'ecrire une reponse apres le Stop", async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const alice = client();
    const joined = await join(alice, {
      code,
      nickname: 'Alice',
      playerId: host.playerId,
      token: host.token,
    });
    if (!joined.ok) throw new Error('join en echec');

    const keep = joined.session.settings.categories[0];
    if (!keep) throw new Error('categorie absente');

    alice.emit('settings:update', { roundDurationSeconds: null });
    alice.emit('game:start');
    await waitForState(alice, (session) => session.phase === 'round_active');

    alice.emit('round:stop');
    await waitForEvent(alice, 'round:stopped');

    const error = waitForEvent(alice, 'error');
    alice.emit('round:answer', { categoryId: keep.id, value: 'Trop tard' });
    expect((await error).code).toBe('INVALID_PHASE');
  }, 20_000);
});

describe('depart de l hote', () => {
  it('transfere le role a un autre joueur', async () => {
    const host = await createSessionOverHttp(server.url, 'Alice');
    const code = host.code;
    const alice = client();
    const bob = client();
    const aliceJoin = await join(alice, {
      code,
      nickname: 'Alice',
      playerId: host.playerId,
      token: host.token,
    });
    const bobJoin = await join(bob, { code, nickname: 'Bob' });
    if (!aliceJoin.ok || !bobJoin.ok) throw new Error('join en echec');

    const transferred = waitForState(bob, (session) => session.hostId === bobJoin.playerId);
    alice.emit('session:leave');

    const session = await transferred;
    expect(session.players).toHaveLength(1);
  });
});

describe('health check', () => {
  it('repond avec le nombre de sessions vivantes', async () => {
    await createSessionOverHttp(server.url, 'Alice');
    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; sessions: number };
    expect(body.status).toBe('ok');
    expect(body.sessions).toBe(1);
  });
});

function bobIdOf(session: ClientSession): string {
  const bob = session.players.find((player) => player.nickname === 'Bob');
  if (!bob) throw new Error('Bob absent');
  return bob.id;
}
