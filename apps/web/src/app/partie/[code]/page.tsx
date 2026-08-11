'use client';

import { Suspense, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { normalizeSessionCode } from '@bacc/shared';
import { useGame } from '@/hooks/useGame';
import { useSfx } from '@/hooks/useSfx';
import { Button } from '@/components/ui/Button';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { LetterDraw } from '@/components/LetterDraw';
import { Lobby } from '@/components/Lobby';
import { ReviewStage } from '@/components/ReviewStage';
import { RoundPlay } from '@/components/RoundPlay';
import { Scoreboard } from '@/components/Scoreboard';
import { Toasts } from '@/components/Toasts';

export default function GamePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return (
    <Suspense fallback={<Splash message="Chargement..." />}>
      <GameRoom code={normalizeSessionCode(code)} />
    </Suspense>
  );
}

function GameRoom({ code }: { code: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const nicknameHint = searchParams.get('pseudo') ?? '';

  const {
    session,
    playerId,
    connection,
    joinStatus,
    fatalError,
    toasts,
    drafts,
    clockOffset,
    actions,
  } = useGame(code, nicknameHint);
  const sfx = useSfx();

  if (joinStatus === 'rejected') {
    return (
      <Splash message={fatalError ?? 'Impossible de rejoindre cette partie.'}>
        <Button full onClick={() => router.push(`/?code=${code}`)}>
          Retour a l accueil
        </Button>
      </Splash>
    );
  }

  if (!session) {
    return <Splash message="Connexion a la partie..." />;
  }

  return (
    <>
      <ConnectionBanner status={connection} />

      <main className="mx-auto w-full max-w-2xl px-4 pb-6 pt-6">
        <nav className="mb-4 flex items-center justify-between gap-3">
          <Link href="/" className="text-sm text-slate-400 transition hover:text-slate-200">
            ← Quitter
          </Link>
          <span className="flex items-center gap-3">
            <span className="chip text-xs tracking-[0.2em] text-slate-300">{session.code}</span>
            <button
              type="button"
              onClick={sfx.toggle}
              aria-label={sfx.enabled ? 'Couper le son' : 'Activer le son'}
              className="h-9 w-9 rounded-xl bg-white/5 text-lg"
            >
              {sfx.enabled ? '🔊' : '🔇'}
            </button>
          </span>
        </nav>

        <PhaseView
          session={session}
          playerId={playerId}
          drafts={drafts}
          clockOffset={clockOffset}
          actions={actions}
        />
      </main>

      <Toasts toasts={toasts} />
    </>
  );
}

type PhaseViewProps = Parameters<typeof RoundPlay>[0];

/** Aiguillage sur la phase : l'ecran affiche suit strictement l'etat serveur. */
function PhaseView({ session, playerId, drafts, clockOffset, actions }: PhaseViewProps) {
  switch (session.phase) {
    case 'lobby':
      return <Lobby session={session} playerId={playerId} actions={actions} />;

    case 'letter_draw':
      return <LetterDraw pool={session.settings.letterPool} />;

    case 'round_active':
      return (
        <RoundPlay
          session={session}
          playerId={playerId}
          drafts={drafts}
          clockOffset={clockOffset}
          actions={actions}
        />
      );

    case 'reveal':
    case 'voting':
    case 'category_results':
      return (
        <ReviewStage
          session={session}
          playerId={playerId}
          clockOffset={clockOffset}
          actions={actions}
        />
      );

    case 'round_results':
    case 'game_over':
      return <Scoreboard session={session} playerId={playerId} actions={actions} />;

    default:
      return <Splash message="Phase inconnue." />;
  }
}

function Splash({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-slate-300">{message}</p>
      {children}
    </main>
  );
}
