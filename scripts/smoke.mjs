/**
 * Verification de bout en bout d'une instance : deux joueurs jouent une manche
 * complete, du tirage de la lettre au calcul des scores.
 *
 * Usage :
 *   npm run build && npm start &
 *   node scripts/smoke.mjs                      # cible http://127.0.0.1:3000
 *   URL=https://mon-app.onrender.com node scripts/smoke.mjs
 */
import { io } from 'socket.io-client';

const URL = process.env.URL ?? 'http://127.0.0.1:3000';

const connect = () => {
  const socket = io(URL, { path: '/socket.io', transports: ['websocket'], reconnection: false });
  socket.on('connect_error', (error) => fail(`connexion impossible: ${error.message}`));
  return socket;
};

const connected = (socket) =>
  new Promise((resolve) => (socket.connected ? resolve() : socket.on('connect', resolve)));

const join = (socket, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('join sans reponse')), 10_000);
    socket.emit('session:join', payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });

const waitForState = (socket, predicate, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`delai depasse: ${label}`)), 30_000);
    const listener = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('session:state', listener);
      resolve(state);
    };
    socket.on('session:state', listener);
  });

const waitForEvent = (socket, event) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`delai depasse: ${event}`)), 30_000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const ok = (message) => console.log(`  ok  ${message}`);

function fail(message) {
  console.error(`ECHEC: ${message}`);
  process.exit(1);
}

const health = await fetch(`${URL}/health`).then((r) => r.json());
if (health.status !== 'ok') fail(`health check: ${JSON.stringify(health)}`);
ok('health check');

const created = await fetch(`${URL}/api/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ nickname: 'Alice' }),
}).then((r) => r.json());
ok(`partie ${created.code} creee`);

const alice = connect();
const bob = connect();
await connected(alice);
await connected(bob);
ok('deux joueurs connectes en WebSocket');

const aliceJoin = await join(alice, {
  code: created.code,
  nickname: 'Alice',
  playerId: created.playerId,
  token: created.token,
});
if (!aliceJoin.ok) fail(`Alice ne peut pas rejoindre: ${aliceJoin.code}`);

const aliceSeesBob = waitForState(alice, (s) => s.players.length === 2, 'arrivee de Bob');
const bobJoin = await join(bob, { code: created.code, nickname: 'Bob' });
if (!bobJoin.ok) fail(`Bob ne peut pas rejoindre: ${bobJoin.code}`);
const lobby = await aliceSeesBob;
ok('les deux joueurs se voient dans le salon');

for (const category of lobby.settings.categories.slice(1)) {
  alice.emit('category:remove', { categoryId: category.id });
}
const single = await waitForState(alice, (s) => s.settings.categories.length === 1, 'categorie');
const category = single.settings.categories[0];
alice.emit('settings:update', { roundCount: 1, roundDurationSeconds: null });

const roundStarted = waitForState(bob, (s) => s.phase === 'round_active', 'manche');
alice.emit('game:start');
const active = await roundStarted;
ok(`lettre "${active.round.letter}" tiree et vue par les deux joueurs`);

alice.emit('round:answer', { categoryId: category.id, value: `${active.round.letter}rbre` });
await new Promise((resolve) => setTimeout(resolve, 500));

const stopSeenByAlice = waitForEvent(alice, 'round:stopped');
bob.emit('round:stop');
const stop = await stopSeenByAlice;
if (stop.byNickname !== 'Bob') fail('le Stop n a pas ete attribue au bon joueur');
ok('le Stop de Bob gele instantanement la manche chez Alice');

await waitForState(alice, (s) => s.phase === 'voting', 'vote');
alice.emit('vote:cast', { categoryId: category.id, targetPlayerId: bobJoin.playerId, points: 0 });
bob.emit('vote:cast', { categoryId: category.id, targetPlayerId: aliceJoin.playerId, points: 2 });

const results = await waitForState(alice, (s) => s.phase === 'round_results', 'resultats');
const scores = Object.fromEntries(results.players.map((p) => [p.nickname, p.totalScore]));
if (scores.Alice !== 2) fail(`Alice devrait avoir 2 points, elle en a ${scores.Alice}`);
if (scores.Bob !== -1) fail(`Bob devrait avoir -1 (malus stoppeur), il en a ${scores.Bob}`);
ok(`scores conformes: ${JSON.stringify(scores)}`);

alice.close();
bob.close();
console.log('\nInstance operationnelle.');
process.exit(0);
