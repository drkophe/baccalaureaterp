'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { Toast } from '@/hooks/useGame';

const STYLES: Record<Toast['kind'], string> = {
  info: 'bg-ink-800 text-slate-100 border-white/10',
  success: 'bg-mint/90 text-ink-950 border-mint',
  warning: 'bg-accent text-ink-950 border-accent',
  error: 'bg-coral text-white border-coral',
};

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`max-w-sm rounded-2xl border px-4 py-2.5 text-sm font-medium shadow-xl ${STYLES[toast.kind]}`}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
