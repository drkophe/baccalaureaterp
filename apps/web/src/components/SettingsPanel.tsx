'use client';

import { DEFAULT_LETTER_POOL, FULL_LETTER_POOL, LIMITS, type Settings } from '@bacc/shared';
import type { SettingsUpdatePayload } from '@bacc/shared';
import { Toggle } from '@/components/ui/Toggle';

export interface SettingsPanelProps {
  settings: Settings;
  isHost: boolean;
  onChange: (patch: SettingsUpdatePayload) => void;
}

const SCORING_LABELS: Record<Settings['scoringMode'], { title: string; hint: string }> = {
  hybrid: {
    title: 'Vote assiste',
    hint: 'La note classique est pre-selectionnee, les joueurs confirment ou corrigent.',
  },
  vote: {
    title: 'Vote libre',
    hint: 'Les joueurs decident seuls : 2, 1 ou 0 point pour chaque reponse.',
  },
  auto: {
    title: 'Automatique',
    hint: 'Pas de vote : reponse unique 2 pts, reponse en double 1 pt, sinon 0.',
  },
};

export function SettingsPanel({ settings, isHost, onChange }: SettingsPanelProps) {
  const timed = settings.roundDurationSeconds !== null;

  return (
    <section className="card space-y-4">
      <h2 className="font-display text-lg font-bold">Reglages</h2>

      <Toggle
        label="Manche minutee"
        hint={timed ? undefined : "La manche ne s'arrete que lorsqu'un joueur clique sur Stop."}
        checked={timed}
        disabled={!isHost}
        onChange={(value) => onChange({ roundDurationSeconds: value ? 120 : null })}
      />

      {timed ? (
        <label className="block space-y-2 rounded-2xl bg-white/5 p-4">
          <span className="flex items-baseline justify-between">
            <span className="font-medium">Duree d une manche</span>
            <span className="tabular-nums text-accent">{settings.roundDurationSeconds}s</span>
          </span>
          <input
            type="range"
            className="w-full accent-[#ffd166]"
            min={LIMITS.MIN_ROUND_DURATION}
            max={LIMITS.MAX_ROUND_DURATION}
            step={5}
            disabled={!isHost}
            value={settings.roundDurationSeconds ?? 120}
            onChange={(event) => onChange({ roundDurationSeconds: Number(event.target.value) })}
          />
        </label>
      ) : null}

      <label className="block space-y-2 rounded-2xl bg-white/5 p-4">
        <span className="flex items-baseline justify-between">
          <span className="font-medium">Nombre de manches</span>
          <span className="tabular-nums text-accent">{settings.roundCount}</span>
        </span>
        <input
          type="range"
          className="w-full accent-[#ffd166]"
          min={LIMITS.MIN_ROUNDS}
          max={LIMITS.MAX_ROUNDS}
          step={1}
          disabled={!isHost}
          value={settings.roundCount}
          onChange={(event) => onChange({ roundCount: Number(event.target.value) })}
        />
      </label>

      <Toggle
        label="Les joueurs peuvent proposer des categories"
        hint={`Chacun peut en ajouter jusqu'a ${LIMITS.MAX_CATEGORIES_PER_PLAYER}.`}
        checked={settings.playersCanAddCategories}
        disabled={!isHost}
        onChange={(value) => onChange({ playersCanAddCategories: value })}
      />

      <fieldset className="space-y-2 rounded-2xl bg-white/5 p-4" disabled={!isHost}>
        <legend className="font-medium">Attribution des points</legend>
        {(Object.keys(SCORING_LABELS) as Settings['scoringMode'][]).map((mode) => (
          <label
            key={mode}
            className={`flex cursor-pointer items-start gap-3 rounded-xl p-2 transition ${
              settings.scoringMode === mode ? 'bg-accent/10' : 'hover:bg-white/5'
            }`}
          >
            <input
              type="radio"
              name="scoringMode"
              className="mt-1 accent-[#ffd166]"
              checked={settings.scoringMode === mode}
              onChange={() => onChange({ scoringMode: mode })}
            />
            <span>
              <span className="block font-medium">{SCORING_LABELS[mode].title}</span>
              <span className="block text-sm text-slate-400">{SCORING_LABELS[mode].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {settings.scoringMode !== 'auto' ? (
        <Toggle
          label="Temps de vote limite"
          hint={
            settings.voteDurationSeconds
              ? `${settings.voteDurationSeconds}s par categorie`
              : 'On attend que tout le monde ait vote.'
          }
          checked={settings.voteDurationSeconds !== null}
          disabled={!isHost}
          onChange={(value) => onChange({ voteDurationSeconds: value ? 30 : null })}
        />
      ) : null}

      <Toggle
        label="Malus pour le joueur qui coupe la manche"
        hint="Une reponse a 0 point vaut -1 si ce joueur a declenche le Stop."
        checked={settings.stopperPenalty}
        disabled={!isHost}
        onChange={(value) => onChange({ stopperPenalty: value })}
      />

      <Toggle
        label="Ne pas rejouer une lettre deja sortie"
        checked={settings.excludeUsedLetters}
        disabled={!isHost}
        onChange={(value) => onChange({ excludeUsedLetters: value })}
      />

      <Toggle
        label="Inclure les lettres difficiles (K, Q, W, X, Y, Z)"
        checked={settings.letterPool.length > DEFAULT_LETTER_POOL.length}
        disabled={!isHost}
        onChange={(value) =>
          onChange({ letterPool: value ? FULL_LETTER_POOL : DEFAULT_LETTER_POOL })
        }
      />
    </section>
  );
}
