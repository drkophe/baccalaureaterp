'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { ConnectionStatus } from '@/hooks/useGame';

/**
 * Retour visible en cas de coupure : un silence donnerait l'impression d'un bug
 * alors que la reconnexion est en cours et que la place dans la partie est gardee.
 */
export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  const visible = status !== 'online';

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -48, opacity: 0 }}
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3
            bg-amber-500/95 px-4 py-2 text-sm font-semibold text-ink-950 shadow-lg"
          role="status"
          aria-live="polite"
        >
          <span className="h-2.5 w-2.5 animate-ping rounded-full bg-ink-950/70" />
          {status === 'connecting' ? 'Connexion au serveur...' : 'Reconnexion en cours...'}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
