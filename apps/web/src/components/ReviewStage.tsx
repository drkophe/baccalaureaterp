'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  computeAutoScore,
  SCORE_VALUES,
  type ClientSession,
  type ResolvedScore,
  type VotePoints,
} from '@bacc/shared';
import type { GameActions } from '@/hooks/useGame';
import { playSound } from '@/hooks/useSfx';
import { Timer } from '@/components/Timer';

export interface ReviewStageProps {
  session: ClientSession;
  playerId: string | null;
  clockOffset: number;
  actions: GameActions;
}

const POINT_LABELS: Record<VotePoints, string> = {
  0: 'Nul',
  1: '1 pt',
  2: '2 pts',
};

/**
 * Revelation puis vote, categorie par categorie.
 *
 * Les trois phases (`reveal`, `voting`, `category_results`) partagent le meme
 * ecran : seules les cartes affichees et le pied de page changent, ce qui evite
 * un saut visuel entre le suspense et le vote.
 */
export function ReviewStage({ session, playerId, clockOffset, actions }: ReviewStageProps) {
  const round = session.round;
  if (!round) return null;

  const category = round.categories[round.reviewIndex];
  if (!category) return null;

  const revealing = session.phase === 'reveal';
  const voting = session.phase === 'voting';
  const scored = session.phase === 'category_results';

  const visiblePlayers = revealing
    ? round.revealOrder.slice(0, round.revealCursor)
    : round.participants;

  const resolved = round.resolved[category.id];
  const answersForCategory: Record<string, string | undefined> = Object.fromEntries(
    round.participants.map((id) => [id, round.answers[id]?.[category.id]]),
  );

  const nicknameOf = (id: string): string =>
    session.players.find((player) => player.id === id)?.nickname ?? 'Joueur parti';

  const myVoteFor = (targetId: string): VotePoints | undefined =>
    playerId ? round.votes[category.id]?.[targetId]?.[playerId] : undefined;

  const votesLeft = voting
    ? round.participants.filter((target) => target !== playerId && myVoteFor(target) === undefined)
        .length
    : 0;

  return (
    <div className="space-y-4">
      <header className="card flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-slate-400">
            Categorie {round.reviewIndex + 1}/{round.categories.length}
          </p>
          <h2 className="truncate font-display text-2xl font-bold">{category.label}</h2>
          <p className="text-sm text-accent">Lettre {round.letter}</p>
        </div>

        {voting && session.deadline?.kind === 'vote_end' ? (
          <Timer endsAt={session.deadline.at} clockOffset={clockOffset} label="Vote" />
        ) : null}
      </header>

      {voting ? (
        <p className="rounded-2xl bg-white/5 px-4 py-2 text-center text-sm text-slate-300">
          {votesLeft > 0
            ? `Il te reste ${votesLeft} reponse${votesLeft > 1 ? 's' : ''} a noter`
            : `En attente des autres joueurs (${round.votersDone.length}/${
                round.participants.filter((id) =>
                  session.players.some((player) => player.id === id && player.connected),
                ).length
              } ont vote)`}
        </p>
      ) : null}

      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {visiblePlayers.map((targetId, index) => {
            const answer = answersForCategory[targetId] ?? '';
            const score = resolved?.[targetId];
            const isMine = targetId === playerId;
            const isStopper = round.stoppedBy === targetId;

            // En mode assiste, la note classique est proposee comme point de depart.
            const suggestion =
              session.settings.scoringMode === 'hybrid' && voting
                ? computeAutoScore(targetId, answersForCategory, round.participants, round.letter)
                    .base
                : null;

            return (
              <motion.li
                key={targetId}
                layout
                initial={{ opacity: 0, y: 24, rotateX: -35 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ type: 'spring', stiffness: 240, damping: 20, delay: index * 0.02 }}
                className={`card space-y-3 ${isMine ? 'border-accent/40' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{nicknameOf(targetId)}</span>
                    {isStopper ? (
                      <span className="chip border-coral/40 bg-coral/10 px-2 py-0 text-xs text-coral">
                        a stoppe
                      </span>
                    ) : null}
                  </span>
                  {score ? <ScoreBadge score={score} /> : null}
                </div>

                <p
                  className={`font-display text-2xl font-bold ${
                    answer.trim() ? 'text-slate-100' : 'text-slate-500 italic'
                  }`}
                >
                  {answer.trim() || 'Pas de reponse'}
                </p>

                {score && score.duplicateWith.length > 0 ? (
                  <p className="text-sm text-slate-400">
                    Meme reponse que {score.duplicateWith.map(nicknameOf).join(', ')}
                  </p>
                ) : null}

                {voting && !isMine ? (
                  <div className="flex gap-2">
                    {SCORE_VALUES.map((points) => {
                      const selected = myVoteFor(targetId) === points;
                      const suggested = suggestion === points && !selected;
                      return (
                        <button
                          key={points}
                          type="button"
                          onClick={() => {
                            playSound('vote');
                            actions.vote(category.id, targetId, points);
                          }}
                          className={`min-h-[44px] flex-1 rounded-2xl border font-semibold transition
                            active:scale-95 ${
                              selected
                                ? 'border-accent bg-accent text-ink-950'
                                : suggested
                                  ? 'border-accent/40 bg-accent/10 text-accent'
                                  : 'border-white/10 bg-white/5 text-slate-200'
                            }`}
                        >
                          {POINT_LABELS[points]}
                          {suggested ? (
                            <span className="ml-1 text-xs opacity-70">suggere</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {voting && isMine ? (
                  <p className="text-sm text-slate-400">Les autres notent ta reponse.</p>
                ) : null}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {revealing ? (
        <p className="text-center text-sm text-slate-400">
          {round.revealCursor}/{round.revealOrder.length} reponses revelees...
        </p>
      ) : null}

      {scored ? (
        <p className="text-center text-sm text-slate-400">Categorie suivante dans un instant...</p>
      ) : null}
    </div>
  );
}

function ScoreBadge({ score }: { score: ResolvedScore }) {
  const positive = score.points > 0;
  const negative = score.points < 0;

  return (
    <motion.span
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 14 }}
      className={`shrink-0 rounded-full px-3 py-1 font-display text-lg font-black tabular-nums ${
        negative
          ? 'bg-coral text-white'
          : positive
            ? 'bg-mint text-ink-950'
            : 'bg-white/10 text-slate-300'
      }`}
      title={score.penalty ? 'Malus : a coupe la manche avec une reponse nulle' : undefined}
    >
      {score.points > 0 ? `+${score.points}` : score.points}
    </motion.span>
  );
}
