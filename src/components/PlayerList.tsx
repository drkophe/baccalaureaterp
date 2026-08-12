'use client';

import { motion } from 'framer-motion';
import type { ClientSession } from '@/shared';

export interface PlayerListProps {
  session: ClientSession;
  playerId: string | null;
  /** Affiche la progression de saisie plutot que le statut « pret ». */
  showProgress?: boolean;
}

export function PlayerList({ session, playerId, showProgress = false }: PlayerListProps) {
  const totalCategories = session.round?.categories.length ?? 0;

  return (
    <ul className="flex flex-wrap gap-2">
      {session.players.map((player) => {
        const isHost = player.id === session.hostId;
        const isMe = player.id === playerId;
        const filled = session.round?.filledCounts[player.id] ?? 0;
        const done = totalCategories > 0 && filled >= totalCategories;

        return (
          <motion.li
            key={player.id}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`chip ${isMe ? 'border-accent/60 bg-accent/10' : ''} ${
              player.connected ? '' : 'opacity-50'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${player.connected ? 'bg-mint' : 'bg-slate-500'}`}
              title={player.connected ? 'En ligne' : 'Deconnecte'}
            />
            <span className="max-w-[10rem] truncate font-medium">{player.nickname}</span>
            {isHost ? <span title="Hote">👑</span> : null}

            {showProgress && totalCategories > 0 ? (
              <span className={`text-xs tabular-nums ${done ? 'text-mint' : 'text-slate-400'}`}>
                {filled}/{totalCategories}
              </span>
            ) : null}

            {!showProgress && session.phase === 'lobby' && player.ready ? (
              <span className="text-xs text-mint">pret</span>
            ) : null}

            {session.phase !== 'lobby' ? (
              <span className="text-xs tabular-nums text-accent">{player.totalScore}</span>
            ) : null}
          </motion.li>
        );
      })}
    </ul>
  );
}
