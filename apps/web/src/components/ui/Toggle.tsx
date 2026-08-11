'use client';

export interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, hint, disabled }: ToggleProps) {
  return (
    <label
      className={`flex items-start justify-between gap-4 rounded-2xl bg-white/5 p-4 ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-sm text-slate-400">{hint}</span> : null}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition ${
          checked ? 'bg-accent' : 'bg-white/20'
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-ink-950 transition-all ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </button>
    </label>
  );
}
