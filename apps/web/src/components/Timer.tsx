'use client';

import { useEffect, useState } from 'react';

export interface TimerProps {
  /** Fin theorique, en horloge serveur. */
  endsAt: number;
  /** Decalage horloge serveur - horloge locale, pour ne pas afficher un compte faux. */
  clockOffset: number;
  totalMs?: number;
  label?: string;
}

/** Compte a rebours purement visuel : le serveur reste seul juge de la fin de manche. */
export function Timer({ endsAt, clockOffset, totalMs, label }: TimerProps) {
  const [remaining, setRemaining] = useState(() => endsAt - (Date.now() + clockOffset));

  useEffect(() => {
    const update = (): void => setRemaining(endsAt - (Date.now() + clockOffset));
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [endsAt, clockOffset]);

  const clamped = Math.max(0, remaining);
  const seconds = Math.ceil(clamped / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const urgent = clamped <= 10_000;
  const ratio = totalMs && totalMs > 0 ? Math.min(1, Math.max(0, clamped / totalMs)) : null;

  return (
    <div className="flex flex-col items-end gap-1">
      {label ? (
        <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      ) : null}
      <span
        className={`font-display text-2xl font-bold tabular-nums transition-colors ${
          urgent ? 'text-coral' : 'text-slate-100'
        }`}
        aria-live={urgent ? 'assertive' : 'off'}
      >
        {minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `${seconds}s`}
      </span>
      {ratio !== null ? (
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
          <span
            className={`block h-full rounded-full transition-[width] duration-300 ${
              urgent ? 'bg-coral' : 'bg-accent'
            }`}
            style={{ width: `${ratio * 100}%` }}
          />
        </span>
      ) : null}
    </div>
  );
}
