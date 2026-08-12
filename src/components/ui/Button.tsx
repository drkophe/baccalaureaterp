'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-ink-950 hover:bg-accent-soft active:bg-accent shadow-lg shadow-accent/20',
  secondary: 'bg-white/10 text-slate-100 hover:bg-white/20 border border-white/10',
  ghost: 'bg-transparent text-slate-300 hover:bg-white/10',
  danger: 'bg-coral/90 text-white hover:bg-coral',
};

const SIZES: Record<Size, string> = {
  // Cibles tactiles d'au moins 44px de haut, recommandation mobile.
  sm: 'min-h-[40px] px-3 text-sm',
  md: 'min-h-[48px] px-5 text-base',
  lg: 'min-h-[56px] px-6 text-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  full = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-semibold
        transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
        ${VARIANTS[variant]} ${SIZES[size]} ${full ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
