/**
 * Verification manuelle du fonctionnement multi-instance.
 *
 * Deux joueurs sont connectes a DEUX processus serveur differents, partageant le
 * meme Redis. Le scenario echoue si l'adapter Redis ou le store partage ne font
 * pas leur travail : c'est le test qui protege la mise en production derriere un
 * load balancer.
 *
 * Usage :
 *   docker compose up -d redis
 *   PORT=4001 npm start -w @bacc/server &
 *   PORT=4002 npm start -w @bacc/server &
 *   node scripts/smoke-multi-instance.mjs
 */
import { io } from 'socket.io-client';

const INSTANCE_A = process.env.INSTANCE_A ?? 'http://127.0.0.1:4001';
const INSTANCE_B = process.env.INSTANCE_B ?? 'http://127.0.0.1:4002';

const connect = (url) => {
  const socket = io(url, { path: '/socket.io', transports: ['websocket'], reconnection: false });
  socket.on('connect_error', (error) => fail(`connexion impossible a ${url}: ${error.message}`));
  return socket;
};

const connected = (socket) =>
  new Promise((resolve) => (socket.connected ? resolve() : socket.on('connect', resolve)));

const join = (socket, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('join sans reponse')), 5_000);
    socket.emit('session:join', payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });

const waitForState = (socket, predicate, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`delai depasse: ${label}`)), 25_000);
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
    const timer = setTimeout(() => reject(new Error(`delai depasse: ${event}`)), 25_000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

function ok(message) {
  console.log(`  ok  ${message}`);
}

function fail(message) {
  console.error(`ECHEC: ${message}`);
  process.exit(1);
}

const created = await fetch(`${INSTANCE_A}/api/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ nickname: 'Alice' }),
}).then((response) => response.json());

console.log(`Session ${created.code} creee sur l'instance A`);

const alice = connect(INSTANCE_A);
const bob = connect(INSTANCE_B);
await connected(alice);
await connected(bob);

const aliceJoin = await join(alice, {
  code: created.code,
  nickname: 'Alice',
  playerId: created.playerId,
  token: created.token,
});
if (!aliceJoin.ok) fail(`Alice ne peut pas rejoindre: ${aliceJoin.code}`);

const aliceSeesBob = waitForState(alice, (state) => state.players.length === 2, 'arrivee de Bob');
const bobJoin = await join(bob, { code: created.code, nickname: 'Bob' });
if (!bobJoin.ok) fail(`Bob ne peut pas rejoindre: ${bobJoin.code}`);
await aliceSeesBob;
ok('un joueur de l instance B est visible depuis l instance A');

const settingsSynced = waitForState(bob, (state) => state.settings.roundCount === 1, 'reglages');
alice.emit('settings:update', { roundCount: 1, roundDurationSeconds: null });
const lobby = await settingsSynced;
ok('les reglages de l instance A atteignent l instance B');

for (const category of lobby.settings.categories.slice(1)) {
  alice.emit('category:remove', { categoryId: category.id });
}
const single = await waitForState(
  alice,
  (state) => state.settings.categories.length === 1,
  'categorie unique',
);
const category = single.settings.categories[0];

const roundStarted = waitForState(bob, (state) => state.phase === 'round_active', 'manche');
alice.emit('game:start');
const active = await roundStarted;
ok(`lettre "${active.round.letter}" tiree et diffusee aux deux instances`);

alice.emit('round:answer', { categoryId: category.id, value: `${active.round.letter}rbre` });
await new Promise((resolve) => setTimeout(resolve, 500));

const stopSeenByAlice = waitForEvent(alice, 'round:stopped');
bob.emit('round:stop');
const stop = await stopSeenByAlice;
if (stop.byNickname !== 'Bob') fail('le Stop n a pas ete attribue au bon joueur');
ok('le Stop declenche sur l instance B gele la manche sur l instance A');

await waitForState(alice, (state) => state.phase === 'voting', 'vote');
alice.emit('vote:cast', { categoryId: category.id, targetPlayerId: bobJoin.playerId, points: 0 });
bob.emit('vote:cast', { categoryId: category.id, targetPlayerId: aliceJoin.playerId, points: 2 });

const results = await waitForState(alice, (state) => state.phase === 'round_results', 'resultats');
const scores = Object.fromEntries(
  results.players.map((player) => [player.nickname, player.totalScore]),
);

if (scores.Alice !== 2) fail(`Alice devrait avoir 2 points, elle en a ${scores.Alice}`);
if (scores.Bob !== -1) fail(`Bob devrait avoir -1 point (malus stoppeur), il en a ${scores.Bob}`);
ok(`scores conformes: ${JSON.stringify(scores)} (malus -1 applique au stoppeur)`);

alice.close();
bob.close();
console.log('\nMulti-instance operationnel.');
process.exit(0);
