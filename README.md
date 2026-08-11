# Baccalauréat — le Petit Bac en ligne

Jeu du Baccalauréat multijoueur, en temps réel, **sans inscription** : un pseudo suffit.
Une lettre est tirée, chacun remplit ses catégories, le premier qui clique sur **Stop**
arrête la manche pour tout le monde, puis on révèle et on vote catégorie par catégorie.

---

## Sommaire

- [Architecture](#architecture)
- [Modèle de session](#modèle-de-session)
- [Machine à états](#machine-à-états)
- [Événements WebSocket](#événements-websocket)
- [Règles de score](#règles-de-score)
- [Démarrage local](#démarrage-local)
- [Variables d'environnement](#variables-denvironnement)
- [Tests](#tests)
- [Déploiement](#déploiement)
- [Choix de production](#choix-de-production)

---

## Architecture

Monorepo npm workspaces, TypeScript de bout en bout.

```
.
├── packages/shared/          # Contrat commun front <-> back (aucune dependance runtime)
│   └── src/
│       ├── types.ts          # Modele de session (serveur) + vue client redigee
│       ├── events.ts         # Noms et payloads des evenements Socket.io
│       ├── schemas.ts        # Validation Zod de TOUTE entree client
│       ├── sanitize.ts       # Nettoyage/normalisation des textes joueurs
│       ├── redact.ts         # Projection serveur -> client (anti-fuite)
│       ├── errors.ts         # Codes d'erreur + messages utilisateur
│       └── game/
│           ├── engine.ts     # Transitions pures sur l'objet Session
│           ├── stateMachine.ts # Table des transitions autorisees
│           ├── scoring.ts    # Calcul des points et des votes
│           └── letters.ts    # Tirage de lettre, melange
│
├── apps/server/              # Node + Express + Socket.io + Redis
│   └── src/
│       ├── index.ts          # Bootstrap, arret propre
│       ├── config.ts         # Configuration validee par Zod
│       ├── logger.ts         # Logs structures (pino)
│       ├── scheduler.ts      # Horloge partagee (echeances + menage)
│       ├── http/app.ts       # Helmet, CORS, /health, POST /api/sessions
│       ├── store/            # SessionStore : Redis (prod) ou memoire (dev)
│       ├── game/             # Identites, creation de session
│       └── socket/           # Handlers, garde, diffusion
│
├── apps/web/                 # Next.js 15 (App Router) + React 19 + Tailwind
│   └── src/
│       ├── app/              # / (accueil) et /partie/[code]
│       ├── components/       # Un composant par phase de jeu
│       ├── hooks/useGame.ts  # Connexion, rejoin, etat, actions
│       └── lib/              # Socket client, identite localStorage
│
└── scripts/smoke-multi-instance.mjs  # Verification du fonctionnement multi-instance
```

**Séparation stricte** : la logique de jeu (`packages/shared/src/game`) ne connaît ni Redis,
ni Socket.io, ni React. Elle manipule un objet `Session` via des fonctions de transition et
reçoit son horloge, son aléa et son générateur d'identifiants par injection (`EngineDeps`),
ce qui la rend testable de bout en bout sans infrastructure.

La couche réseau ne fait que : **charger → appliquer une transition → sauvegarder → diffuser**.

---

## Modèle de session

Une session est un seul document JSON dans Redis (`bacc:session:<CODE>`), avec TTL.

```ts
interface Session {
  code: string;              // Code court partageable (5 caracteres non ambigus)
  version: number;           // Incremente a chaque mutation (garde anti-regression client)
  phase: GamePhase;          // Etat de la machine a etats
  hostId: string;            // Hote courant (transfere automatiquement s'il part)
  players: ServerPlayer[];   // Pseudo, connecte ?, score, hash du token de reconnexion
  settings: Settings;        // Duree, manches, categories, mode de score, malus...
  usedLetters: string[];     // Lettres deja sorties dans la partie
  round: Round | null;       // Manche en cours (voir ci-dessous)
  deadline: Deadline | null; // Prochaine echeance { kind, at, seq }
  deadlineSeq: number;       // Compteur d'unicite des echeances
  completedRounds: number;
}

interface Round {
  index: number;
  letter: string;
  startedAt / endsAt / stoppedAt: number | null;
  stoppedBy: string | null;      // Joueur ayant coupe la manche (null = chronometre)
  stopReason: 'player' | 'timeout' | null;
  categories: Category[];        // Snapshot fige au lancement de la manche
  participants: string[];        // Joueurs presents au lancement (les retardataires attendent)
  answers: Record<playerId, Record<categoryId, string>>;
  votes: Record<categoryId, Record<targetId, Record<voterId, 0 | 1 | 2>>>;
  resolved: Record<categoryId, Record<playerId, ResolvedScore>>;
  reviewIndex: number;           // Categorie en cours de revelation / vote
  revealCursor: number;          // Nombre de reponses deja revelees
  revealOrder: string[];         // Ordre de revelation (melange a chaque categorie)
  roundScores: Record<playerId, number>;
}
```

Le client ne reçoit **jamais** cet objet tel quel : `redactSession(session, viewerId)` en
produit une projection par joueur. Pendant la manche, chacun ne voit que ses propres
réponses (les autres se résument à un compteur de champs remplis) ; pendant la révélation,
les réponses n'apparaissent qu'au fur et à mesure du curseur ; les votes des autres restent
secrets jusqu'à la clôture de la catégorie ; le hash du token de reconnexion ne sort jamais.

---

## Machine à états

```
lobby ──▶ letter_draw ──▶ round_active ──▶ reveal ──▶ voting ──▶ category_results
                                             ▲                          │
                                             └──────────────────────────┤ categorie suivante
                                                                        │
                          round_results ◀─────────────────────────────  ┘ derniere categorie
                                │
                                ├──▶ letter_draw   (manche suivante)
                                └──▶ game_over ──▶ lobby   (rejouer)
```

Toute transition passe par `transition()`, qui refuse tout enchaînement non déclaré dans
`PHASE_TRANSITIONS` : un état incohérent lève une erreur métier au lieu de corrompre la partie.

Les transitions temporisées (fin d'animation de tirage, fin de manche, pas de révélation, fin
de vote, passage à la catégorie suivante) ne reposent **pas** sur un `setTimeout` local. Elles
vivent dans une file triée partagée (ZSET Redis) que toutes les instances consomment ; chaque
échéance porte un numéro de séquence, donc elle ne peut être appliquée qu'une seule fois même
si deux instances la réclament en même temps.

---

## Événements WebSocket

### Client → serveur

| Événement          | Payload                                           | Notes                                            |
| ------------------ | ------------------------------------------------- | ------------------------------------------------ |
| `session:join`     | `{ code, nickname, playerId?, token? }` + ack     | `playerId`/`token` = reconnexion                 |
| `session:leave`    | —                                                 | Départ volontaire                                |
| `player:ready`     | `{ ready: boolean }`                              | Lobby uniquement                                 |
| `settings:update`  | `Partial<Settings>`                               | Hôte uniquement, lobby uniquement                |
| `category:add`     | `{ label }`                                       | Hôte, ou joueur si le toggle est actif           |
| `category:remove`  | `{ categoryId }`                                  | Un joueur ne retire que ses propres propositions |
| `category:reorder` | `{ categoryIds: string[] }`                       | Hôte uniquement                                  |
| `game:start`       | —                                                 | Hôte uniquement                                  |
| `game:abort`       | —                                                 | Hôte : retour au salon en cours de partie        |
| `game:lobby`       | —                                                 | Hôte : rejouer depuis l'écran final              |
| `round:answer`     | `{ categoryId, value }`                           | Regroupé côté client (~200 ms)                   |
| `round:stop`       | —                                                 | Fige la manche pour tout le monde                |
| `round:next`       | —                                                 | Hôte : manche suivante ou classement final       |
| `vote:cast`        | `{ categoryId, targetPlayerId, points: 0\|1\|2 }` | Refusé si la catégorie n'est plus celle affichée |

### Serveur → client

| Événement                       | Payload                              | Notes                                                     |
| ------------------------------- | ------------------------------------ | --------------------------------------------------------- |
| `session:state`                 | `ClientSession`                      | **Source de vérité**, rédigée par destinataire            |
| `round:progress`                | `{ filledCounts }`                   | Léger : émis à chaque frappe, sans rediffuser tout l'état |
| `round:letter`                  | `{ letter, roundIndex }`             | Émis au démarrage réel de la manche                       |
| `round:stopped`                 | `{ reason, byPlayerId, byNickname }` | Déclenche le verrouillage visuel et le son                |
| `reveal:step`                   | `{ categoryId, playerId, index }`    | Une réponse révélée                                       |
| `category:closed`               | `{ categoryId }`                     | Score de la catégorie disponible                          |
| `player:joined` / `player:left` | `{ playerId, nickname }`             | Toasts                                                    |
| `host:changed`                  | `{ hostId, nickname }`               | Transfert du rôle d'hôte                                  |
| `notice`                        | `{ kind, message }`                  | Messages d'ambiance                                       |
| `error`                         | `{ code, message, origin }`          | Erreur métier, jamais une stack                           |

Le client applique `session:state` seulement si `version` est supérieure à celle déjà
affichée : un état en retard arrivant après une reconnexion ne peut pas faire régresser l'UI.

---

## Règles de score

Trois modes, réglables par l'hôte avant le lancement.

| Mode                | Comportement                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `auto`              | Règle classique seule, sans phase de vote : réponse unique **2 pts**, réponse partagée **1 pt**, vide ou mauvaise lettre **0**. |
| `vote`              | Les joueurs décident seuls (2 / 1 / 0).                                                                                         |
| `hybrid` _(défaut)_ | La note classique est **pré-sélectionnée** dans l'interface ; les votes exprimés font foi.                                      |

- Les votes sont agrégés par la **médiane** (arrondi supérieur sur une médiane à `.5`) :
  un vote isolé malveillant ne peut pas faire basculer une réponse à lui seul.
- Un joueur ne vote jamais pour lui-même ; les votes de non-participants sont ignorés.
- Sans aucun vote exprimé (partie à un seul joueur, tout le monde s'abstient), on retombe
  sur la note automatique plutôt que sur 0.
- **Malus du stoppeur** : si la réponse évaluée appartient au joueur qui a déclenché le Stop
  et qu'elle est jugée à 0, elle vaut **−1**. Le malus ne s'applique jamais quand la manche
  s'est terminée au chronomètre, et il est désactivable dans les réglages.

---

## Démarrage local

Prérequis : Node ≥ 20, et Redis (ou Docker).

```bash
git clone <ce-depot> && cd baccalaureaterp
npm install
cp .env.example .env

# Redis (au choix)
docker compose up -d redis      # ou : redis-server

# Serveur + front en parallele
npm run dev
```

- Front : http://localhost:3000
- API / WebSocket : http://localhost:4000
- Health check : http://localhost:4000/health

> Sans Redis sous la main, `ALLOW_MEMORY_STORE=true` fait basculer le serveur sur un store
> mémoire. Pratique en développement, **refusé au démarrage** si `NODE_ENV=production` :
> le store mémoire casserait la synchronisation entre instances.

Pour tester à plusieurs sur un téléphone du même réseau, exposer l'IP de la machine :

```bash
NEXT_PUBLIC_SERVER_URL=http://192.168.1.20:4000 npm run dev -w @bacc/web
# et cote serveur :
CORS_ORIGINS=http://192.168.1.20:3000 npm run dev -w @bacc/server
```

---

## Variables d'environnement

Voir `.env.example`. Les principales :

| Variable                 | Défaut                   | Rôle                                                                    |
| ------------------------ | ------------------------ | ----------------------------------------------------------------------- |
| `PORT` / `HOST`          | `4000` / `0.0.0.0`       | Écoute du serveur                                                       |
| `CORS_ORIGINS`           | `http://localhost:3000`  | Origines autorisées, séparées par `,`. **`*` est refusé en production** |
| `REDIS_URL`              | `redis://127.0.0.1:6379` | Store de sessions + adapter Socket.io                                   |
| `REDIS_PREFIX`           | `bacc`                   | Préfixe des clés (permet de partager une instance Redis)                |
| `ALLOW_MEMORY_STORE`     | `false`                  | Repli mémoire si Redis est injoignable. Interdit en production          |
| `LOG_LEVEL`              | `info`                   | Niveau des logs structurés                                              |
| `TRUST_PROXY`            | `1`                      | Nombre de proxies devant l'app (vraie IP pour le rate limiting)         |
| `DISABLE_RATE_LIMIT`     | `false`                  | À réserver aux tests                                                    |
| `NEXT_PUBLIC_SERVER_URL` | `http://localhost:4000`  | URL du serveur **vue du navigateur** (figée au build du front)          |

La configuration est validée par Zod au démarrage : une valeur incohérente arrête le process
avec un message explicite plutôt que de laisser tourner un serveur mal configuré.

---

## Tests

```bash
npm test          # logique de jeu + machine a etats + integration socket
npm run lint
npm run typecheck
```

- `packages/shared` — **82 tests unitaires** : calcul des points, agrégation des votes,
  malus du stoppeur, doublons/accents, table des transitions, échéances, reconnexion,
  transfert d'hôte, limites de catégories.
- `apps/server` — **15 tests d'intégration** qui parlent au serveur comme un vrai navigateur
  (HTTP + WebSocket, store réel) : création, join, reconnexion avec token, refus d'un token
  invalide, payload malformé sans coupure de connexion, manche complète du tirage au score,
  transfert d'hôte, health check.

Vérification du fonctionnement multi-instance (nécessite Redis) :

```bash
docker compose up -d redis
npm run build
PORT=4001 npm start -w @bacc/server &
PORT=4002 npm start -w @bacc/server &
node scripts/smoke-multi-instance.mjs
```

Le scénario place deux joueurs sur **deux processus serveur différents** et vérifie qu'ils se
voient, que les réglages se propagent, que le Stop de l'un gèle la manche de l'autre, et que
les scores (malus compris) sont identiques des deux côtés.

---

## Déploiement

### Docker Compose

```bash
cp .env.example .env
CORS_ORIGINS=https://mon-domaine.fr \
NEXT_PUBLIC_SERVER_URL=https://api.mon-domaine.fr \
docker compose up --build -d
```

### Vercel (front uniquement)

Vercel peut héberger `apps/web`, **mais pas `apps/server`** : le serveur temps réel maintient
des connexions WebSocket ouvertes, ce qu'une fonction serverless ne permet pas. Le serveur doit
tourner sur une plateforme à processus long (Railway, Render, Fly.io, Scaleway, une VM…), avec
un Redis à côté.

Configuration du projet Vercel :

| Réglage                  | Valeur                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Root Directory           | `apps/web`                                                                           |
| Install / Build Command  | valeurs par défaut (`npm install` / `npm run build`)                                 |
| Variable d'environnement | `NEXT_PUBLIC_SERVER_URL` = URL publique du serveur, ex. `https://api.mon-domaine.fr` |

`NEXT_PUBLIC_SERVER_URL` est lue **à la compilation** : après l'avoir modifiée, il faut
redéployer, un simple redémarrage ne suffit pas.

Côté serveur, `CORS_ORIGINS` doit lister le domaine Vercel (`https://mon-projet.vercel.app`,
plus le domaine personnalisé s'il existe), sans quoi le navigateur refusera la connexion.

> Le paquet `@bacc/shared` est publié sous forme compilée (`dist/`), qui n'est pas versionnée.
> Les scripts `prebuild` de `apps/web` et `apps/server` le compilent donc automatiquement avant
> leur propre build : un `npm run build` dans l'une ou l'autre app fonctionne depuis un clone
> vierge, sans étape manuelle.

### Montée en charge

L'état vit dans Redis et les messages transitent par l'adapter Redis de Socket.io : ajouter
des instances ne demande aucun changement de code.

```bash
docker compose up -d --scale server=3
```

À placer derrière un load balancer :

- router `/socket.io` **et** `/api` vers le service `server` ;
- autoriser la mise à niveau WebSocket (`Upgrade` / `Connection`) ;
- `/health` comme sonde de disponibilité — il renvoie `503` si le store ne répond plus,
  ce qui sort l'instance du pool au lieu de lui envoyer des joueurs.

Les sessions collantes ne sont **pas** nécessaires : n'importe quelle instance peut servir
n'importe quel joueur. En revanche, si le load balancer ne supporte pas WebSocket, Socket.io
retombera sur le long-polling, qui exige lui des sessions collantes — préférer le WebSocket.

### Exploitation

- Logs JSON une ligne par événement (pino), niveaux `info` / `warn` / `error`, avec le code
  de session et l'identifiant de joueur. Les tokens de reconnexion sont expurgés.
- Les sessions portent un TTL de 6 h, rafraîchi à chaque action : une partie abandonnée
  disparaît toute seule, sans fuite mémoire.
- Un passage de ménage retire les joueurs dont la fenêtre de reconnexion (90 s) est écoulée,
  et supprime la session dès qu'elle est vide.
- `SIGTERM` / `SIGINT` déclenchent un arrêt propre (fermeture des sockets, du serveur HTTP,
  puis de Redis), avec sortie forcée après 10 s.

---

## Choix de production

**Robustesse.** Chaque handler socket passe par une garde commune qui valide le payload
(Zod), applique le rate limiting, vérifie l'authentification, puis capture toute exception :
une entrée malformée renvoie un événement `error` typé et ne fait jamais tomber le process.
Côté client, la reconnexion est automatique et signalée par un bandeau explicite plutôt que
par un écran figé.

**Sécurité.** Tout texte affiché à d'autres joueurs (pseudo, catégorie, réponse) est
assaini à l'entrée : caractères de contrôle et invisibles supprimés, délimiteurs HTML
retirés, longueur bornée. CORS explicite, `*` refusé en production, en-têtes Helmet, aucun
secret en dur. L'identité tient dans un couple `playerId` + token aléatoire dont seul le
**hash SHA-256** est stocké côté serveur : reprendre la place d'un joueur exige son token.

**Concurrence.** Deux joueurs de la même partie peuvent être servis par deux instances
différentes. Toute mutation prend donc un verrou distribué sur la session (`SET NX PX` +
libération par script Lua comparant le propriétaire) : lecture, transition et écriture sont
sérialisées, sans quoi deux votes simultanés pourraient s'écraser.

**Cas limites traités.** Joueur arrivant après le lancement (il regarde, il jouera la manche
suivante) ; hôte qui part (rôle transféré au joueur connecté le plus ancien) ; partie à un
seul joueur (le vote est sauté, la note automatique s'applique) ; votant déconnecté (il ne
bloque pas la catégorie) ; plus personne en ligne (la partie retombe au salon) ; onglets
multiples (le joueur n'est considéré parti qu'à la fermeture du dernier).

**Mobile d'abord.** Cibles tactiles d'au moins 44 px, champs à 16 px pour éviter le zoom
automatique de Safari iOS, zones sûres respectées, boutons d'action fixés en bas d'écran,
mise en page pensée pour le pouce.
