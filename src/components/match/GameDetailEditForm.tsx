'use client';

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import InlinePokemonPicker from '@/components/match/InlinePokemonPicker';
import { useDataLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAdmin, errorsMatches } from '@/i18n/messages/errors';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { BattleStat, GameSource } from '@/types/game';

/** A form error: a client-side check (by key) or an API failure. Translated at render. */
type EditorError =
  | { kind: 'selectWinner' }
  | { kind: 'invalidNames' }
  | { kind: 'saveFailed' }
  | { kind: 'api'; error: ApiErrorLike };

interface PlayerInfo {
  id: string;
  name: string;
}

interface GameDetailEditFormProps {
  gameId: string;
  source: GameSource;
  currentWinnerId: string | null;
  player1: PlayerInfo;
  player2: PlayerInfo;
  battleStats: BattleStat[];
  onCancel: () => void;
  /** Called after a successful save and `router.refresh()`. */
  onSaved?: () => void;
}

interface PokemonStatInput {
  /** Stable client key so React preserves input focus when reordering / removing rows. */
  key: string;
  pokemon_name: string;
  pokemon_valid: boolean;
  kos_dealt: number;
  was_koed: boolean;
  was_lead: boolean;
  was_brought: boolean;
  moves_used: string;
  turns_active: number;
}

function buildStatInput(stat: BattleStat, key: string): PokemonStatInput {
  return {
    key,
    pokemon_name: stat.pokemon_name,
    pokemon_valid: true,
    kos_dealt: stat.kos_dealt,
    was_koed: stat.was_koed,
    was_lead: stat.was_lead,
    was_brought: stat.was_brought,
    moves_used: stat.moves_used.join(', '),
    turns_active: stat.turns_active,
  };
}

function buildEmptyRow(key: string): PokemonStatInput {
  return {
    key,
    pokemon_name: '',
    pokemon_valid: true,
    kos_dealt: 0,
    was_koed: false,
    was_lead: false,
    was_brought: true,
    moves_used: '',
    turns_active: 0,
  };
}

/**
 * Inline editor swapped into a `GameDetailCard` when an admin opens edit mode.
 * Mirrors the data model of `/admin/matches/[id]/games/[gid]/edit` but is
 * compact enough to live inside the public match detail page.
 */
export default function GameDetailEditForm({
  gameId,
  source,
  currentWinnerId,
  player1,
  player2,
  battleStats,
  onCancel,
  onSaved,
}: GameDetailEditFormProps) {
  const router = useRouter();
  const t = useT(matchFormsMessages);
  const dataLocale = useDataLocale();
  const apiErrorText = useApiErrorText(errorsAdmin, errorsMatches);
  const players = useMemo(() => [player1, player2], [player1, player2]);

  // Component-scoped key generator: useId() guarantees a unique base per
  // mounted instance (works across SSR and concurrent rendering), and a ref
  // counter advances stably for new rows without leaking into other forms.
  const idBase = useId();
  const seqRef = useRef(0);
  const nextKey = useCallback(() => {
    seqRef.current += 1;
    return `${idBase}-row-${seqRef.current}`;
  }, [idBase]);

  const [winnerId, setWinnerId] = useState<string>(currentWinnerId ?? '');
  const [rows, setRows] = useState<[PokemonStatInput[], PokemonStatInput[]]>(() => {
    const p1 = battleStats
      .filter((s) => s.player_id === player1.id)
      .map((s) => buildStatInput(s, nextKey()));
    const p2 = battleStats
      .filter((s) => s.player_id === player2.id)
      .map((s) => buildStatInput(s, nextKey()));
    return [
      p1.length > 0 ? p1 : [buildEmptyRow(nextKey())],
      p2.length > 0 ? p2 : [buildEmptyRow(nextKey())],
    ];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<EditorError | null>(null);

  const updateRow = useCallback(
    <K extends keyof PokemonStatInput>(
      playerIdx: number,
      rowIdx: number,
      field: K,
      value: PokemonStatInput[K],
    ) => {
      setRows((prev) => {
        const next = [...prev] as [PokemonStatInput[], PokemonStatInput[]];
        next[playerIdx] = next[playerIdx].map((r, i) =>
          i === rowIdx ? { ...r, [field]: value } : r,
        );
        return next;
      });
    },
    [],
  );

  const addRow = useCallback(
    (playerIdx: number) => {
      setRows((prev) => {
        const next = [...prev] as [PokemonStatInput[], PokemonStatInput[]];
        next[playerIdx] = [...next[playerIdx], buildEmptyRow(nextKey())];
        return next;
      });
    },
    [nextKey],
  );

  const removeRow = useCallback(
    (playerIdx: number, rowIdx: number) => {
      setRows((prev) => {
        const next = [...prev] as [PokemonStatInput[], PokemonStatInput[]];
        next[playerIdx] = next[playerIdx].filter((_, i) => i !== rowIdx);
        if (next[playerIdx].length === 0) {
          next[playerIdx] = [buildEmptyRow(nextKey())];
        }
        return next;
      });
    },
    [nextKey],
  );

  const allValid = rows.every((side) =>
    side.every((r) => r.pokemon_valid || r.pokemon_name.trim() === ''),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!winnerId) {
      setError({ kind: 'selectWinner' });
      return;
    }
    if (!allValid) {
      setError({ kind: 'invalidNames' });
      return;
    }

    setSaving(true);
    try {
      const battle_stats = players.flatMap((player, idx) =>
        rows[idx]
          .filter((r) => r.pokemon_name.trim().length > 0)
          .map((r) => ({
            player_id: player.id,
            pokemon_name: r.pokemon_name.trim(),
            kos_dealt: r.kos_dealt,
            was_koed: r.was_koed,
            was_lead: r.was_lead,
            was_brought: r.was_brought,
            moves_used: r.moves_used
              .split(',')
              .map((m) => m.trim())
              .filter(Boolean),
            turns_active: r.turns_active,
          })),
      );

      const res = await fetch(`/api/admin/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner_id: winnerId, battle_stats }),
      });
      const json = await res.json();
      if (!json?.success) {
        const apiError = toApiErrorLike(json);
        setError(apiError.error || apiError.code ? { kind: 'api', error: apiError } : { kind: 'saveFailed' });
        return;
      }

      router.refresh();
      onSaved?.();
    } catch {
      setError({ kind: 'saveFailed' });
    } finally {
      setSaving(false);
    }
  }

  function errorMessage(e: EditorError): string {
    switch (e.kind) {
      case 'selectWinner':
        return t('common.selectWinner');
      case 'invalidNames':
        return t('editor.invalidNames');
      case 'saveFailed':
        return t('editor.saveFailed');
      case 'api':
        return apiErrorText(e.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-4" data-export-hide>
      {source === 'ps_replay' && (
        <Alert variant="warning" className="text-xs">
          {t('editor.replayWarning')}
        </Alert>
      )}

      {/* Winner selector */}
      <div>
        <label className="block text-[11px] font-heading text-poke-text-muted mb-1.5">
          {t('common.winner')}
        </label>
        <div className="flex gap-2">
          {players.map((p) => {
            const active = winnerId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setWinnerId(p.id)}
                className={`px-3 py-1.5 rounded-poke-md text-xs border transition-colors font-heading font-semibold ${
                  active
                    ? 'bg-poke-blue text-poke-on-blue border-poke-blue shadow-poke-sm'
                    : 'bg-poke-surface text-poke-text-secondary border-poke-border hover:border-poke-blue'
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-player Pokémon rows */}
      <div className="flex flex-col lg:flex-row gap-4">
        {players.map((player, pIdx) => (
          <fieldset
            key={player.id}
            className="flex-1 min-w-0 rounded-poke-md border border-poke-border p-3"
          >
            <legend className="px-1 text-xs font-heading font-semibold text-poke-text-secondary">
              {player.name}
            </legend>
            <div className="space-y-3">
              {rows[pIdx].map((row, rIdx) => (
                <div
                  key={row.key}
                  className={
                    rIdx === 0
                      ? 'space-y-2'
                      : 'space-y-2 border-t border-poke-border/40 pt-3'
                  }
                >
                  {/* Sub-row 1: Pokémon picker + remove button */}
                  <div className="grid grid-cols-12 gap-1.5 items-end">
                    <div className="col-span-10">
                      <label className="text-[10px] text-poke-text-muted">{t('editor.pokemon')}</label>
                      <InlinePokemonPicker
                        value={row.pokemon_name}
                        onChange={(name) => {
                          updateRow(pIdx, rIdx, 'pokemon_name', name);
                          updateRow(pIdx, rIdx, 'pokemon_valid', true);
                        }}
                        onValidityChange={(valid) =>
                          updateRow(pIdx, rIdx, 'pokemon_valid', valid)
                        }
                      />
                    </div>
                    <div className="col-span-2 flex items-end justify-end pb-1.5">
                      <button
                        type="button"
                        onClick={() => removeRow(pIdx, rIdx)}
                        aria-label={t('editor.removePokemon')}
                        className="text-poke-accent text-base leading-none hover:opacity-80 px-1"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {/* Sub-row 2: KOs / Turns / Moves / Lead·KO'd·Brought */}
                  <div className="grid grid-cols-12 gap-1.5 items-end">
                    <div className="col-span-3 sm:col-span-2">
                      <label className="text-[10px] text-poke-text-muted">{t('common.kos')}</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={row.kos_dealt}
                        onChange={(e) =>
                          updateRow(
                            pIdx,
                            rIdx,
                            'kos_dealt',
                            Number.parseInt(e.target.value, 10) || 0,
                          )
                        }
                        className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                      />
                    </div>
                    <div className="col-span-3 sm:col-span-2">
                      <label className="text-[10px] text-poke-text-muted">{t('common.turns')}</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={row.turns_active}
                        onChange={(e) =>
                          updateRow(
                            pIdx,
                            rIdx,
                            'turns_active',
                            Number.parseInt(e.target.value, 10) || 0,
                          )
                        }
                        className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                      />
                    </div>
                    <div className="col-span-6 sm:col-span-5">
                      <label className="text-[10px] text-poke-text-muted">{t('editor.moves')}</label>
                      <input
                        type="text"
                        value={row.moves_used}
                        onChange={(e) =>
                          updateRow(pIdx, rIdx, 'moves_used', e.target.value)
                        }
                        placeholder={t('editor.commaSeparated')}
                        className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-3 flex flex-wrap gap-x-2 gap-y-1 items-center pb-1.5">
                      <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                        <input
                          type="checkbox"
                          checked={row.was_lead}
                          onChange={(e) =>
                            updateRow(pIdx, rIdx, 'was_lead', e.target.checked)
                          }
                        />
                        {t('common.lead')}
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                        <input
                          type="checkbox"
                          checked={row.was_koed}
                          onChange={(e) =>
                            updateRow(pIdx, rIdx, 'was_koed', e.target.checked)
                          }
                        />
                        {t('common.koed')}
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                        <input
                          type="checkbox"
                          checked={row.was_brought}
                          onChange={(e) =>
                            updateRow(pIdx, rIdx, 'was_brought', e.target.checked)
                          }
                        />
                        {t('common.brought')}
                      </label>
                    </div>
                  </div>

                  {!row.pokemon_valid && row.pokemon_name.trim().length > 0 && (
                    <p className="text-[10px] text-poke-accent">
                      {t('editor.pickSuggestion', { name: localizeSpecies(row.pokemon_name, dataLocale) })}
                    </p>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => addRow(pIdx)}
                className="text-[11px] text-poke-blue hover:underline font-heading"
              >
                {t('common.addPokemon')}
              </button>
            </div>
          </fieldset>
        ))}
      </div>

      {error && <Alert variant="error">{errorMessage(error)}</Alert>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {t('editor.saveChanges')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          {t('editor.cancel')}
        </Button>
      </div>
    </form>
  );
}
