'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CATEGORY_SUGGESTIONS, LIMITS, type Category } from '@bacc/shared';
import { Button } from '@/components/ui/Button';

export interface CategoryEditorProps {
  categories: Category[];
  isHost: boolean;
  playersCanAdd: boolean;
  playerId: string | null;
  onAdd: (label: string) => void;
  onRemove: (categoryId: string) => void;
  onReorder: (categoryIds: string[]) => void;
}

/**
 * Liste des categories : l'hote gere tout, un joueur ne peut ajouter (et retirer)
 * que ses propres propositions, et seulement si l'hote l'a autorise.
 */
export function CategoryEditor({
  categories,
  isHost,
  playersCanAdd,
  playerId,
  onAdd,
  onRemove,
  onReorder,
}: CategoryEditorProps) {
  const [draft, setDraft] = useState('');
  const canAdd = (isHost || playersCanAdd) && categories.length < LIMITS.MAX_CATEGORIES;

  const submit = (): void => {
    const label = draft.trim();
    if (!label) return;
    onAdd(label);
    setDraft('');
  };

  const canRemove = (category: Category): boolean =>
    isHost || (playersCanAdd && category.addedBy === playerId);

  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const ids = categories.map((category) => category.id);
    const current = ids[index];
    const swapped = ids[target];
    if (!current || !swapped) return;
    ids[index] = swapped;
    ids[target] = current;
    onReorder(ids);
  };

  const suggestions = CATEGORY_SUGGESTIONS.filter(
    (label) => !categories.some((category) => category.label.toLowerCase() === label.toLowerCase()),
  ).slice(0, 6);

  return (
    <section className="card space-y-4">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold">Categories</h2>
        <span className="text-sm text-slate-400">
          {categories.length}/{LIMITS.MAX_CATEGORIES}
        </span>
      </header>

      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {categories.map((category, index) => (
            <motion.li
              key={category.id}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              className="flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2"
            >
              <span className="w-6 shrink-0 text-center text-sm text-slate-500">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate">{category.label}</span>

              {isHost ? (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`Monter ${category.label}`}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="h-9 w-9 rounded-xl bg-white/5 text-slate-300 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Descendre ${category.label}`}
                    onClick={() => move(index, 1)}
                    disabled={index === categories.length - 1}
                    className="h-9 w-9 rounded-xl bg-white/5 text-slate-300 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </span>
              ) : null}

              {canRemove(category) ? (
                <button
                  type="button"
                  aria-label={`Supprimer ${category.label}`}
                  onClick={() => onRemove(category.id)}
                  className="h-9 w-9 shrink-0 rounded-xl bg-white/5 text-coral"
                >
                  ×
                </button>
              ) : null}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {categories.length === 0 ? (
        <p className="rounded-2xl bg-coral/10 px-3 py-2 text-sm text-coral">
          Ajoute au moins une categorie pour pouvoir lancer la partie.
        </p>
      ) : null}

      {canAdd ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              className="field"
              value={draft}
              maxLength={LIMITS.CATEGORY_MAX}
              placeholder="Ajouter une categorie"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <Button onClick={submit} disabled={!draft.trim()}>
              +
            </Button>
          </div>

          {suggestions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onAdd(label)}
                  className="chip text-slate-300 transition hover:border-accent/50 hover:text-accent"
                >
                  + {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Seul l hote peut modifier la liste des categories.</p>
      )}
    </section>
  );
}
