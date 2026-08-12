'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { normalizePool } from '@/shared';

/**
 * Animation de tirage. La lettre reelle n'est pas encore connue du client
 * (le serveur ne la revele qu'au demarrage de la manche) : on fait defiler le
 * pool de lettres, ce qui donne le suspense sans permettre de tricher.
 */
export function LetterDraw({ pool }: { pool: string }) {
  const letters = normalizePool(pool);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((current) => (current + 1) % letters.length);
    }, 80);
    return () => clearInterval(interval);
  }, [letters.length]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Tirage de la lettre</p>

      <motion.div
        animate={{ scale: [1, 1.06, 1], rotate: [-1.5, 1.5, -1.5] }}
        transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
        className="flex h-40 w-40 items-center justify-center rounded-[2rem]
          border-4 border-accent/40 bg-ink-900 shadow-2xl shadow-accent/20"
      >
        <span className="font-display text-7xl font-black text-accent">{letters[index]}</span>
      </motion.div>

      <p className="text-slate-400">Prepare tes doigts...</p>
    </div>
  );
}
