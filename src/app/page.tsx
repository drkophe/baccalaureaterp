'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { LIMITS, isValidSessionCode, normalizeSessionCode } from '@/shared';
import { lastNickname, saveIdentity } from '@/lib/identity';
import { createSessionRequest } from '@/lib/socket';
import { Button } from '@/components/ui/Button';

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNickname(lastNickname());
    // Un lien partage arrive sous la forme /?code=ABCDE : le champ est pre-rempli.
    const shared = searchParams.get('code');
    if (shared) setCode(normalizeSessionCode(shared));
  }, [searchParams]);

  const trimmed = nickname.trim();
  const canSubmit = trimmed.length >= LIMITS.NICKNAME_MIN && !busy;

  const create = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createSessionRequest(trimmed);
      // L'hote est deja inscrit cote serveur : on range son identite avant de
      // naviguer, la page de partie l'utilisera pour se rattacher au socket.
      saveIdentity(created.code, {
        playerId: created.playerId,
        token: created.token,
        nickname: trimmed,
      });
      router.push(`/partie/${created.code}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creation impossible.');
      setBusy(false);
    }
  };

  const joinExisting = (): void => {
    if (!canSubmit) return;
    const normalized = normalizeSessionCode(code);
    if (!isValidSessionCode(normalized)) {
      setError('Ce code de partie ne semble pas valide.');
      return;
    }
    router.push(`/partie/${normalized}?pseudo=${encodeURIComponent(trimmed)}`);
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="font-display text-4xl font-black tracking-tight">
          Bacca<span className="text-accent">laureat</span>
        </h1>
        <p className="mt-2 text-slate-400">
          Le Petit Bac en ligne, entre amis. Pas de compte : un pseudo suffit.
        </p>
      </motion.header>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="card space-y-4"
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-300">Ton pseudo</span>
          <input
            className="field"
            value={nickname}
            maxLength={LIMITS.NICKNAME_MAX}
            placeholder="Alex"
            autoComplete="nickname"
            onChange={(event) => setNickname(event.target.value)}
          />
        </label>

        <Button size="lg" full disabled={!canSubmit} onClick={() => void create()}>
          {busy ? 'Creation...' : 'Creer une partie'}
        </Button>

        <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500">
          <span className="h-px flex-1 bg-white/10" />
          ou
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-300">Code de la partie</span>
          <input
            className="field text-center font-display text-2xl font-bold uppercase tracking-[0.4em]"
            value={code}
            maxLength={LIMITS.SESSION_CODE_LENGTH}
            placeholder="ABCDE"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(event) => setCode(normalizeSessionCode(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') joinExisting();
            }}
          />
        </label>

        <Button
          variant="secondary"
          size="lg"
          full
          disabled={!canSubmit || code.length < LIMITS.SESSION_CODE_LENGTH}
          onClick={joinExisting}
        >
          Rejoindre
        </Button>

        {error ? (
          <p role="alert" className="rounded-2xl bg-coral/15 px-4 py-3 text-sm text-coral">
            {error}
          </p>
        ) : null}
      </motion.section>

      <section className="card space-y-2 text-sm text-slate-400">
        <h2 className="font-display text-base font-bold text-slate-200">Comment on joue</h2>
        <p>
          Une lettre est tiree au sort. Trouve un mot commencant par cette lettre pour chaque
          categorie. Le premier qui clique sur Stop arrete la manche pour tout le monde, puis on
          vote ensemble sur chaque reponse.
        </p>
      </section>
    </main>
  );
}
