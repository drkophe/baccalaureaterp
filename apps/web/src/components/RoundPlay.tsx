'use client';

import { motion } from 'framer-motion';
import { LIMITS, startsWithLetter, type ClientSession } from '@bacc/shared';
import type { GameActions } from '@/hooks/useGame';
import { Button } from '@/components/ui/Button';
import { PlayerList } from '@/components/PlayerList';
import { Timer } from '@/components/Timer';

export interface RoundPlayProps {
  session: ClientSession;
  playerId: string | null;
  drafts: Record<string, string>;
  clockOffset: number;
  actions: GameActions;
}

export function RoundPlay({ session, playerId, drafts, clockOffset, actions }: RoundPlayProps) {
  const round = session.round;
  if (!round) return null;

  const isParticipant = playerId !== null && round.participants.includes(playerId);
  // Le brouillon local prime : il ne doit jamais etre ecrase par un etat serveur
  // arrive entre deux frappes.
  const valueFor = (categoryId: string): string =>
    drafts[categoryId] ?? (playerId ? (round.answers[playerId]?.[categoryId] ?? '') : '');

  const filled = round.categories.filter((category) => valueFor(category.id).trim()).length;
  const totalMs = round.endsAt && round.startedAt ? round.endsAt - round.startedAt : undefined;

  return (
    <div className="space-y-4">
      <header className="card flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-400">
            Manche {round.index + 1}/{session.settings.roundCount}
          </p>
          <motion.p
            key={round.letter}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}
            className="font-display text-5xl font-black text-accent"
          >
            {round.letter}
          </motion.p>
        </div>

        {round.endsAt ? (
          <Timer
            endsAt={round.endsAt}
            clockOffset={clockOffset}
            totalMs={totalMs}
            label="Restant"
          />
        ) : (
          <span className="text-right text-sm text-slate-400">
            Manche
            <br />
            illimitee
          </span>
        )}
      </header>

      <PlayerList session={session} playerId={playerId} showProgress />

      {!isParticipant ? (
        <p className="card text-center text-sm text-slate-300">
          Tu es arrive apres le debut de la manche : tu joueras a partir de la prochaine.
        </p>
      ) : null}

      <ol className="space-y-3">
        {round.categories.map((category, index) => {
          const value = valueFor(category.id);
          const valid = value.trim().length > 0 && startsWithLetter(value, round.letter);
          const wrongLetter = value.trim().length > 0 && !valid;

          return (
            <li key={category.id}>
              <label className="block space-y-1.5">
                <span className="flex items-baseline justify-between px-1">
                  <span className="font-medium">{category.label}</span>
                  {wrongLetter ? (
                    <span className="text-xs text-coral">ne commence pas par {round.letter}</span>
                  ) : null}
                </span>
                <input
                  className={`field ${valid ? 'border-mint/50' : ''} ${wrongLetter ? 'border-coral/60' : ''}`}
                  value={value}
                  disabled={!isParticipant}
                  maxLength={LIMITS.ANSWER_MAX}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint={index === round.categories.length - 1 ? 'done' : 'next'}
                  placeholder={`${round.letter}...`}
                  onChange={(event) => actions.writeAnswer(category.id, event.target.value)}
                  onBlur={actions.flushAnswers}
                />
              </label>
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-0 safe-bottom -mx-4 bg-gradient-to-t from-ink-950 via-ink-950/95 to-transparent px-4 pt-6">
        <Button
          size="lg"
          full
          variant={filled === round.categories.length ? 'primary' : 'secondary'}
          disabled={!isParticipant}
          onClick={actions.stopRound}
        >
          Stop ! J ai fini ({filled}/{round.categories.length})
        </Button>
        {session.settings.stopperPenalty ? (
          <p className="mt-2 text-center text-xs text-slate-400">
            Attention : tes reponses jugees nulles vaudront -1 si tu coupes la manche.
          </p>
        ) : null}
      </div>
    </div>
  );
}
