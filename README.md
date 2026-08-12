# Baccalauréat — le Petit Bac en ligne

Jeu du Baccalauréat multijoueur, en temps réel, **sans inscription** : un pseudo suffit.
Une lettre est tirée, chacun remplit ses catégories, le premier qui clique sur **Stop**
arrête la manche pour tout le monde, puis on révèle et on vote catégorie par catégorie.

**Une seule application, un seul port, aucune variable d'environnement obligatoire.**

---

## Démarrage en 30 secondes

```bash
npm install
npm run dev
```

C'est tout : http://localhost:3000. Pas de Redis à installer, pas de `.env` à remplir,
pas de second terminal à ouvrir.

Pour tester à plusieurs sur le même réseau (téléphones compris), utilisez l'IP de votre
machine : `http://192.168.1.20:3000`. Rien d'autre à configurer.

---

## Déploiement

Le projet est **un seul service web Node**. Le front Next.js et le serveur temps réel
Socket.io tournent dans le même processus, sur le même port.

|                           |                           |
| ------------------------- | ------------------------- |
| Build Command             | `npm ci && npm run build` |
| Start Command             | `npm start`               |
| Root Directory            | _(vide)_                  |
| Variables d'environnement | **aucune**                |

Cela fonctionne tel quel sur Render, Railway, Fly.io, Koyeb, un VPS, ou via le `Dockerfile`.

### Render

Deux possibilités :

- **Blueprint** (le plus simple) : _New → Blueprint_, pointer sur ce dépôt. Le fichier
  `render.yaml` décrit le service, il n'y a rien à saisir.
- **Manuel** : _New → Web Service_, laisser **Root Directory vide**, mettre les deux
  commandes du tableau ci-dessus, et `/health` en _Health Check Path_. Aucune variable.

> Le plan Free s'endort après ~15 min d'inactivité : la première connexion prend
> alors ~30 s le temps du réveil. Pour des parties régulières, le plan Starter (7 $)
> supprime cette latence.

### Docker

```bash
docker build -t baccalaureat .
docker run -p 3000:3000 baccalaureat
```

### Vérifier un déploiement

```bash
URL=https://mon-app.onrender.com node scripts/smoke.mjs
```

Le script fait jouer deux joueurs une manche complète contre l'instance visée et
vérifie le résultat, y compris le malus du joueur qui coupe la manche.

---

## Architecture

```
.
├── server.ts               # Point d'entree unique : Next + Express + Socket.io
├── src/
│   ├── app/                # Pages : / (accueil) et /partie/[code]
│   ├── components/         # Un composant par phase de jeu
│   ├── hooks/              # useGame (temps reel), useSfx (sons)
│   ├── lib/                # Client socket, identite localStorage
│   │
│   ├── game/               # Moteur de jeu pur (aucune dependance technique)
│   │   ├── engine.ts       #   Transitions sur l'objet Session
│   │   ├── stateMachine.ts #   Table des transitions autorisees
│   │   ├── scoring.ts      #   Calcul des points et des votes
│   │   └── letters.ts      #   Tirage de lettre, melange
│   │
│   ├── shared/             # Contrat commun navigateur <-> serveur
│   │   ├── types.ts        #   Modele de session + vue client
│   │   ├── events.ts       #   Evenements Socket.io et leurs payloads
│   │   ├── schemas.ts      #   Validation Zod de toute entree client
│   │   ├── sanitize.ts     #   Nettoyage des textes joueurs
│   │   ├── redact.ts       #   Projection serveur -> client (anti-fuite)
│   │   └── errors.ts       #   Codes d'erreur et messages
│   │
│   └── server/             # Couche technique
│       ├── config.ts       #   Configuration (tout est optionnel)
│       ├── api.ts          #   /health et POST /api/sessions
│       ├── scheduler.ts    #   Echeances du jeu et menage des sessions
│       ├── store/          #   Etat des parties : memoire, ou Redis si configure
│       └── socket/         #   Handlers, garde, diffusion
│
└── scripts/smoke.mjs       # Verification de bout en bout d'une instance
```

**Le moteur de jeu ne connaît ni le réseau, ni le stockage, ni React.** Il manipule un
objet `Session` via des fonctions de transition, et reçoit son horloge, son aléa et son
générateur d'identifiants par injection — d'où 97 tests qui tournent sans infrastructure.

La couche réseau ne fait que : **charger → appliquer une transition → sauvegarder → diffuser**.

### Machine à états

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

Toute transition passe par `transition()`, qui refuse les enchaînements non déclarés :
un état incohérent lève une erreur métier au lieu de corrompre la partie.

### Ce que le client ne voit pas

`redactSession(session, viewerId)` produit une projection par joueur : pendant la manche,
chacun ne voit que ses propres réponses (les autres se résument à un compteur de champs
remplis) ; pendant la révélation, les réponses apparaissent au fur et à mesure ; les votes
des autres restent secrets jusqu'à la clôture ; la lettre elle-même n'est envoyée qu'au
démarrage effectif de la manche, pas pendant l'animation de tirage.

---

## Règles de score

Trois modes, réglables par l'hôte avant le lancement.

| Mode                | Comportement                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `auto`              | Règle classique seule : réponse unique **2 pts**, partagée **1 pt**, vide ou mauvaise lettre **0**. |
| `vote`              | Les joueurs décident seuls (2 / 1 / 0).                                                             |
| `hybrid` _(défaut)_ | La note classique est pré-sélectionnée ; les votes exprimés font foi.                               |

- Les votes sont agrégés par la **médiane** : un vote isolé malveillant ne peut pas
  faire basculer une réponse à lui seul.
- On ne vote jamais pour soi-même ; sans aucun vote exprimé, on retombe sur la note automatique.
- **Malus du stoppeur** : une réponse du joueur ayant déclenché le Stop jugée à 0 vaut **−1**.
  Jamais appliqué sur une fin au chronomètre, et désactivable dans les réglages.

---

## Développement

```bash
npm run dev         # serveur + front, rechargement a chaud
npm test            # 97 tests (moteur, scoring, machine a etats, integration socket)
npm run lint
npm run typecheck   # front et serveur
```

Les tests d'intégration parlent au serveur comme un vrai navigateur (HTTP + WebSocket) :
création, reconnexion avec token, refus d'un token invalide, payload malformé sans coupure
de connexion, manche complète du tirage au score, transfert d'hôte.

---

## Monter en charge (optionnel)

L'état vit par défaut dans la mémoire du process : parfait pour une instance, ce qui
couvre largement des parties entre amis (16 joueurs par partie, plusieurs parties en
parallèle sans difficulté).

Pour faire tourner **plusieurs instances** derrière un load balancer, il suffit de
renseigner `REDIS_URL`. L'état bascule alors dans Redis, avec verrou distribué par
session, et l'adapter Redis de Socket.io relaie les événements entre instances — aucun
changement de code. Les échéances du jeu (fin de manche, révélation, vote) vivent déjà
dans une file triée partagée plutôt que dans des `setTimeout` locaux, précisément pour
que ce basculement fonctionne.

Points d'attention côté load balancer : autoriser la mise à niveau WebSocket, et utiliser
`/health` comme sonde (il renvoie `503` si le store ne répond plus).

---

## Sécurité et robustesse

- Chaque handler socket passe par une garde commune : validation Zod, rate limiting,
  vérification d'identité, capture de toute exception. Une entrée malformée renvoie une
  erreur typée et ne fait jamais tomber le process.
- Tout texte réaffiché chez les autres joueurs (pseudo, catégorie, réponse) est assaini
  à l'entrée : caractères de contrôle et invisibles supprimés, délimiteurs HTML retirés,
  longueur bornée.
- L'identité tient dans un `playerId` + un token aléatoire dont seul le **hash SHA-256**
  est stocké : reprendre la place d'un joueur exige son token.
- En-têtes Helmet, TTL de 6 h sur les sessions, purge des joueurs déconnectés au-delà de
  90 s, transfert automatique du rôle d'hôte, arrêt propre sur `SIGTERM`.
