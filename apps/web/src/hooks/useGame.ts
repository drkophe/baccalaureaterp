'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnswerPayload,
  CategoryAddPayload,
  ClientSession,
  ErrorPayload,
  JoinResult,
  SettingsUpdatePayload,
  VotePoints,
} from '@bacc/shared';
import { clearIdentity, loadIdentity, saveIdentity } from '@/lib/identity';
import { createSocket, type GameClientSocket } from '@/lib/socket';
import { playSound } from '@/hooks/useSfx';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting';
export type JoinStatus = 'joining' | 'joined' | 'rejected';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface GameActions {
  setReady: (ready: boolean) => void;
  updateSettings: (patch: SettingsUpdatePayload) => void;
  addCategory: (label: string) => void;
  removeCategory: (categoryId: string) => void;
  reorderCategories: (categoryIds: string[]) => void;
  startGame: () => void;
  stopRound: () => void;
  nextRound: () => void;
  backToLobby: () => void;
  abortGame: () => void;
  vote: (categoryId: string, targetPlayerId: string, points: VotePoints) => void;
  writeAnswer: (categoryId: string, value: string) => void;
  flushAnswers: () => void;
  leave: () => void;
}

export interface GameStateValue {
  session: ClientSession | null;
  playerId: string | null;
  connection: ConnectionStatus;
  joinStatus: JoinStatus;
  fatalError: string | null;
  toasts: Toast[];
  /** Reponses en cours de saisie, non encore confirmees par le serveur. */
  drafts: Record<string, string>;
  /** Decalage entre l'horloge serveur et l'horloge locale, en ms. */
  clockOffset: number;
  actions: GameActions;
}

const ANSWER_DEBOUNCE_MS = 200;

/**
 * Point d'entree temps reel du client : connexion, rejoin automatique,
 * application des etats recus et exposition des actions.
 *
 * Le serveur reste la source de verite ; le seul etat reellement local est le
 * brouillon de saisie, pour que la frappe ne soit jamais ecrasee par un etat
 * recu entre deux frappes.
 */
export function useGame(code: string, nicknameHint: string): GameStateValue {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [joinStatus, setJoinStatus] = useState<JoinStatus>('joining');
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [clockOffset, setClockOffset] = useState(0);

  const socketRef = useRef<GameClientSocket | null>(null);
  const versionRef = useRef(-1);
  const pendingRef = useRef<Map<string, string>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundKeyRef = useRef<string>('');

  const pushToast = useCallback((kind: Toast['kind'], message: string) => {
    const toast: Toast = { id: Date.now() + Math.random(), kind, message };
    setToasts((current) => [...current.slice(-3), toast]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toast.id));
    }, 4_000);
  }, []);

  const applySession = useCallback((next: ClientSession) => {
    // Les etats peuvent arriver dans le desordre apres une reconnexion :
    // on ignore tout etat plus ancien que celui deja affiche.
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setClockOffset(next.serverNow - Date.now());
    setSession(next);
  }, []);

  /* --------------------------- Connexion et rejoin -------------------------- */

  useEffect(() => {
    if (!code) return undefined;

    const socket = createSocket();
    socketRef.current = socket;

    const attemptJoin = (): void => {
      const stored = loadIdentity(code);
      const nickname = stored?.nickname ?? nicknameHint;
      if (!nickname) {
        setJoinStatus('rejected');
        setFatalError('Choisis un pseudo pour rejoindre cette partie.');
        return;
      }

      socket.emit(
        'session:join',
        {
          code,
          nickname,
          ...(stored ? { playerId: stored.playerId, token: stored.token } : {}),
        },
        (result: JoinResult) => {
          if (!result.ok) {
            // Une identite perimee (partie recreee, session expiree) ne doit pas
            // bloquer le joueur : on la jette et on laisse l'ecran d'accueil reprendre.
            if (result.code === 'NOT_AUTHENTICATED') clearIdentity(code);
            setJoinStatus('rejected');
            setFatalError(result.message);
            return;
          }

          saveIdentity(code, {
            playerId: result.playerId,
            token: result.token,
            nickname:
              result.session.players.find((player) => player.id === result.playerId)?.nickname ??
              nickname,
          });
          setPlayerId(result.playerId);
          setJoinStatus('joined');
          setFatalError(null);
          versionRef.current = -1;
          applySession(result.session);
        },
      );
    };

    socket.on('connect', () => {
      setConnection('online');
      attemptJoin();
    });

    socket.on('disconnect', (reason) => {
      // Une deconnexion demandee par le client n'est pas un incident.
      if (reason === 'io client disconnect') return;
      setConnection('reconnecting');
    });

    socket.io.on('reconnect_attempt', () => setConnection('reconnecting'));
    socket.on('connect_error', () => setConnection('reconnecting'));

    socket.on('session:state', applySession);

    socket.on('round:progress', (payload) => {
      setSession((current) => {
        if (!current?.round) return current;
        return { ...current, round: { ...current.round, filledCounts: payload.filledCounts } };
      });
    });

    socket.on('round:letter', () => playSound('letter'));
    socket.on('reveal:step', () => playSound('reveal'));
    socket.on('category:closed', () => playSound('score'));

    socket.on('round:stopped', (payload) => {
      playSound('stop');
      pushToast(
        'warning',
        payload.reason === 'timeout'
          ? 'Temps ecoule !'
          : `${payload.byNickname ?? 'Quelqu un'} a stoppe la manche !`,
      );
    });

    socket.on('player:joined', (payload) => pushToast('success', `${payload.nickname} a rejoint`));
    socket.on('player:left', (payload) => {
      if (payload.nickname) pushToast('info', `${payload.nickname} a quitte`);
    });
    socket.on('host:changed', (payload) =>
      pushToast('info', `${payload.nickname} est maintenant l hote`),
    );
    socket.on('notice', (payload) => pushToast(payload.kind, payload.message));
    socket.on('error', (payload: ErrorPayload) => pushToast('error', payload.message));

    return () => {
      socket.removeAllListeners();
      socket.close();
      socketRef.current = null;
    };
    // `nicknameHint` ne sert qu'au premier join : le relire ne doit pas relancer
    // la connexion en cours de partie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, applySession, pushToast]);

  /* ------------------------------- Brouillons ------------------------------- */

  // Nouvelle manche : on repart de champs vides.
  const roundKey = `${session?.round?.index ?? -1}:${session?.round?.letter ?? ''}`;
  useEffect(() => {
    if (roundKey === roundKeyRef.current) return;
    roundKeyRef.current = roundKey;
    pendingRef.current.clear();
    setDrafts({});
  }, [roundKey]);

  const flushAnswers = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const socket = socketRef.current;
    if (!socket) return;
    for (const [categoryId, value] of pendingRef.current) {
      const payload: AnswerPayload = { categoryId, value };
      socket.emit('round:answer', payload);
    }
    pendingRef.current.clear();
  }, []);

  const writeAnswer = useCallback(
    (categoryId: string, value: string) => {
      setDrafts((current) => ({ ...current, [categoryId]: value }));
      pendingRef.current.set(categoryId, value);

      // On regroupe les frappes : le serveur recoit au plus quelques mises a jour
      // par seconde, ce qui reste bien en dessous du rate limit.
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flushAnswers, ANSWER_DEBOUNCE_MS);
    },
    [flushAnswers],
  );

  // Les reponses en attente partent avant que la manche ne se verrouille.
  const phase = session?.phase;
  useEffect(() => {
    if (phase !== 'round_active') flushAnswers();
  }, [phase, flushAnswers]);

  /* -------------------------------- Actions -------------------------------- */

  const actions = useMemo<GameActions>(() => {
    const emit: GameClientSocket['emit'] = (...args) => {
      const socket = socketRef.current;
      if (!socket) return false as never;
      return socket.emit(...args);
    };

    return {
      setReady: (ready) => emit('player:ready', { ready }),
      updateSettings: (patch) => emit('settings:update', patch),
      addCategory: (label) => emit('category:add', { label } satisfies CategoryAddPayload),
      removeCategory: (categoryId) => emit('category:remove', { categoryId }),
      reorderCategories: (categoryIds) => emit('category:reorder', { categoryIds }),
      startGame: () => emit('game:start'),
      stopRound: () => {
        flushAnswers();
        emit('round:stop');
      },
      nextRound: () => emit('round:next'),
      backToLobby: () => emit('game:lobby'),
      abortGame: () => emit('game:abort'),
      vote: (categoryId, targetPlayerId, points) =>
        emit('vote:cast', { categoryId, targetPlayerId, points }),
      writeAnswer,
      flushAnswers,
      leave: () => {
        emit('session:leave');
        clearIdentity(code);
      },
    };
  }, [code, flushAnswers, writeAnswer]);

  return {
    session,
    playerId,
    connection,
    joinStatus,
    fatalError,
    toasts,
    drafts,
    clockOffset,
    actions,
  };
}
