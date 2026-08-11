'use client';

import { useState } from 'react';
import type { ClientSession } from '@bacc/shared';
import type { GameActions } from '@/hooks/useGame';
import { Button } from '@/components/ui/Button';
import { CategoryEditor } from '@/components/CategoryEditor';
import { PlayerList } from '@/components/PlayerList';
import { SettingsPanel } from '@/components/SettingsPanel';

export interface LobbyProps {
  session: ClientSession;
  playerId: string | null;
  actions: GameActions;
}

export function Lobby({ session, playerId, actions }: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const isHost = session.hostId === playerId;
  const me = session.players.find((player) => player.id === playerId);
  const canStart = session.settings.categories.length > 0;

  const shareLink =
    typeof window === 'undefined' ? '' : `${window.location.origin}/?code=${session.code}`;

  const share = async (): Promise<void> => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Baccalaureat',
          text: `Rejoins ma partie avec le code ${session.code}`,
          url: shareLink,
        });
        return;
      }
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // L'utilisateur a annule le partage, ou le presse-papier est refuse.
    }
  };

  return (
    <div className="space-y-5">
      <section className="card space-y-4 text-center">
        <p className="text-sm uppercase tracking-widest text-slate-400">Code de la partie</p>
        <p className="font-display text-5xl font-black tracking-[0.3em] text-accent">
          {session.code}
        </p>
        <Button variant="secondary" full onClick={() => void share()}>
          {copied ? 'Lien copie !' : 'Partager le lien'}
        </Button>
      </section>

      <section className="card space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-bold">Joueurs ({session.players.length})</h2>
          {session.players.length === 1 ? (
            <span className="text-sm text-slate-400">En attente d autres joueurs</span>
          ) : null}
        </header>
        <PlayerList session={session} playerId={playerId} />

        {!isHost ? (
          <Button
            variant={me?.ready ? 'secondary' : 'primary'}
            full
            onClick={() => actions.setReady(!me?.ready)}
          >
            {me?.ready ? 'Je ne suis plus pret' : 'Je suis pret'}
          </Button>
        ) : null}
      </section>

      <SettingsPanel
        settings={session.settings}
        isHost={isHost}
        onChange={actions.updateSettings}
      />

      <CategoryEditor
        categories={session.settings.categories}
        isHost={isHost}
        playersCanAdd={session.settings.playersCanAddCategories}
        playerId={playerId}
        onAdd={actions.addCategory}
        onRemove={actions.removeCategory}
        onReorder={actions.reorderCategories}
      />

      <div className="sticky bottom-0 safe-bottom -mx-4 bg-gradient-to-t from-ink-950 via-ink-950/95 to-transparent px-4 pt-6">
        {isHost ? (
          <Button size="lg" full onClick={actions.startGame} disabled={!canStart}>
            Lancer la partie
          </Button>
        ) : (
          <p className="rounded-2xl bg-white/5 px-4 py-3 text-center text-sm text-slate-300">
            L hote lancera la partie quand tout le monde sera pret.
          </p>
        )}
      </div>
    </div>
  );
}
