'use client';

import { motion } from 'framer-motion';
import { buildScoreboard, type ClientSession } from '@bacc/shared';
import type { GameActions } from '@/hooks/useGame';
import { Button } from '@/components/ui/Button';

export interface ScoreboardProps {
  session: ClientSession;
  playerId: string | null;
  actions: GameActions;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** Scores cumules apres une manche, ou classement final en fin de partie. */
export function Scoreboard({ session, playerId, actions }: ScoreboardProps) {
  const isHost = session.hostId === playerId;
  const final = session.phase === 'game_over';
  const entries = buildScoreboard(session.players);
  const roundScores = session.round?.roundScores ?? {};
  const hasMoreRounds = session.completedRounds < session.settings.roundCount;

  return (
    <div className="space-y-5">
      <header className="text-center">
        <h2 className="font-display text-3xl font-black">
          {final ? 'Classement final' : `Manche ${session.completedRounds} terminee`}
        </h2>
        {!final ? (
          <p className="text-sm text-slate-400">
            {hasMoreRounds
              ? `Encore ${session.settings.roundCount - session.completedRounds} manche(s)`
              : 'Derniere manche jouee'}
          </p>
        ) : null}
      </header>

      <ol className="space-y-2">
        {entries.map((entry, index) => {
          const delta = roundScores[entry.playerId] ?? 0;
          const isMe = entry.playerId === playerId;

          return (
            <motion.li
              key={entry.playerId}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.08 }}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${
                isMe ? 'bg-accent/15 ring-1 ring-accent/40' : 'bg-white/5'
              }`}
            >
              <span className="w-8 text-center font-display text-xl font-black text-slate-400">
                {final && entry.rank <= 3 ? MEDALS[entry.rank - 1] : entry.rank}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{entry.nickname}</span>

              {!final && delta !== 0 ? (
                <span className={`text-sm tabular-nums ${delta > 0 ? 'text-mint' : 'text-coral'}`}>
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              ) : null}

              <span className="w-12 text-right font-display text-2xl font-black tabular-nums text-accent">
                {entry.totalScore}
              </span>
            </motion.li>
          );
        })}
      </ol>

      <div className="safe-bottom space-y-3">
        {isHost ? (
          final ? (
            <Button size="lg" full onClick={actions.backToLobby}>
              Rejouer avec les memes joueurs
            </Button>
          ) : (
            <Button size="lg" full onClick={actions.nextRound}>
              {hasMoreRounds ? 'Manche suivante' : 'Voir le classement final'}
            </Button>
          )
        ) : (
          <p className="rounded-2xl bg-white/5 px-4 py-3 text-center text-sm text-slate-300">
            En attente de l hote...
          </p>
        )}
      </div>
    </div>
  );
}
