'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import PokemonLink from '@/components/shared/PokemonLink';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeSprite from '@/components/shared/TypeSprite';
import CategoryIcon from '@/components/shared/CategoryIcon';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useDataLocale, useMessages } from '@/i18n/client';
import { errorsStats } from '@/i18n/messages/errors';
import { statsMessages } from '@/i18n/messages/stats';
import { useApiErrorText } from '@/i18n/use-api-error';
import { localizeMove, moveSearchKeys } from '@/lib/pkmn/i18n/names/moves';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies, speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import { matchRank, NO_MATCH } from '@/lib/pkmn/i18n/search';
import type { DataLocale } from '@/lib/pkmn/i18n/types';
import type { ApiResult } from '@/types/api';
import type {
  MovePokemonTotals,
  MoveUsageResponse,
  MoveUsageRow,
} from '@/types/game';

type SubView = 'by-pokemon' | 'by-move';

/**
 * The explorer's words. The defaults come from the `stats` namespace
 * (`moves`) in the viewer's language; a `labels` prop overrides them.
 */
export interface MoveUsageTableLabels {
  loading: string;
  empty: string;
  noMatches: string;
  /** Shown when the request fails without a message of its own. */
  loadFailed: string;
  pokemon: string;
  move: string;
  searchPokemon: string;
  searchMoves: string;
  clearFilters: string;
  byPokemon: string;
  byMove: string;
  /** "Used" in "Used 12×". */
  used: string;
}

/**
 * The English labels.
 * @deprecated Pass no `labels` to get the viewer's language; kept for callers that still pass it.
 */
export const DEFAULT_MOVE_USAGE_LABELS: MoveUsageTableLabels = { ...statsMessages.en.moves };

interface MoveUsageTableProps {
  scopeType: string;
  scopeId: string | null;
  labels?: MoveUsageTableLabels;
}

/** Type filter keys (English type names, as stored); labels come from the pkmn layer. */
const ALL_TYPES = [
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
] as const;

/**
 * The explorer's filters. The Pokémon and move queries match the English and
 * the German name (and their transliterations), whatever the data locale; the
 * type filter keys are English type names.
 */
export function filterMoveUsageRows(
  rows: readonly MoveUsageRow[],
  filters: { pokemonQuery: string; moveQuery: string; activeTypes: ReadonlySet<string> },
): MoveUsageRow[] {
  const pokeQ = filters.pokemonQuery.trim();
  const moveQ = filters.moveQuery.trim();
  return rows.filter((row) => {
    if (pokeQ && matchRank(pokeQ, speciesSearchKeys(row.pokemon_name)) === NO_MATCH) return false;
    if (moveQ && matchRank(moveQ, moveSearchKeys(row.move_name)) === NO_MATCH) return false;
    if (filters.activeTypes.size > 0) {
      if (!row.move_type || !filters.activeTypes.has(row.move_type)) return false;
    }
    return true;
  });
}

/**
 * Lazy-loaded move usage explorer.
 * Renders two pivots over the same data with shared Pokémon/move/type filters:
 *  - By Pokémon: one card per Pokémon listing the moves it ran.
 *  - By Move:    one card per move listing the Pokémon that used it.
 */
export default function MoveUsageTable({
  scopeType,
  scopeId,
  labels: labelsOverride,
}: MoveUsageTableProps) {
  const localized = useMessages(statsMessages).moves;
  const labels: MoveUsageTableLabels = labelsOverride ?? localized;
  const dl = useDataLocale();
  const errorText = useApiErrorText(errorsStats);
  const [rows, setRows] = useState<MoveUsageRow[]>([]);
  const [pokemonTotals, setPokemonTotals] = useState<MovePokemonTotals[]>([]);
  const [loading, setLoading] = useState(true);
  // The failure is kept as data (never as text) so a language switch re-renders it.
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [view, setView] = useState<SubView>('by-pokemon');

  // Filters
  const [pokemonQuery, setPokemonQuery] = useState('');
  const [moveQuery, setMoveQuery] = useState('');
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    async function fetchMoves() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ scope: scopeType, view: 'moves' });
        if (scopeId) params.set('scope_id', scopeId);

        const res = await fetch(`/api/stats?${params}`);
        const json = (await res.json()) as ApiResult<MoveUsageResponse>;
        if (!active) return;

        if (!res.ok || !json.success) {
          setError(json.success ? {} : toApiErrorLike(json));
          return;
        }

        setRows(json.data.rows);
        setPokemonTotals(json.data.pokemonTotals);
      } catch (err) {
        // A network failure has its own message; anything else (a non-JSON
        // body) shows the explorer's generic "failed to load".
        if (active) setError(err instanceof TypeError ? toApiErrorLike(err) : {});
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchMoves();
    return () => {
      active = false;
    };
  }, [scopeType, scopeId]);

  const pokemonTotalsMap = useMemo(() => {
    const map = new Map<string, MovePokemonTotals>();
    for (const total of pokemonTotals) map.set(total.pokemon_name, total);
    return map;
  }, [pokemonTotals]);

  const filteredRows = useMemo(
    () => filterMoveUsageRows(rows, { pokemonQuery, moveQuery, activeTypes }),
    [rows, pokemonQuery, moveQuery, activeTypes],
  );

  function toggleType(type: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  function clearFilters() {
    setPokemonQuery('');
    setMoveQuery('');
    setActiveTypes(new Set());
  }

  const hasFilters =
    pokemonQuery.trim() !== '' || moveQuery.trim() !== '' || activeTypes.size > 0;

  if (loading) {
    return <div className="py-8 text-center text-poke-text-muted">{labels.loading}</div>;
  }

  if (error) {
    return (
      <Alert variant="error">{error.error || error.code ? errorText(error) : labels.loadFailed}</Alert>
    );
  }

  if (rows.length === 0) {
    return <div className="py-8 text-center text-poke-text-muted">{labels.empty}</div>;
  }

  return (
    <div className="space-y-4">
      <Filters
        pokemonQuery={pokemonQuery}
        moveQuery={moveQuery}
        activeTypes={activeTypes}
        onPokemonChange={setPokemonQuery}
        onMoveChange={setMoveQuery}
        onToggleType={toggleType}
        onClear={clearFilters}
        hasFilters={hasFilters}
        labels={labels}
        dataLocale={dl}
      />
      <SubViewToggle view={view} onChange={setView} labels={labels} />
      {filteredRows.length === 0 ? (
        <div className="py-8 text-center text-poke-text-muted">
          {labels.noMatches}
        </div>
      ) : view === 'by-pokemon' ? (
        <ByPokemonView rows={filteredRows} totals={pokemonTotalsMap} used={labels.used} dataLocale={dl} />
      ) : (
        <ByMoveView rows={filteredRows} used={labels.used} dataLocale={dl} />
      )}
    </div>
  );
}

function Filters({
  pokemonQuery,
  moveQuery,
  activeTypes,
  onPokemonChange,
  onMoveChange,
  onToggleType,
  onClear,
  hasFilters,
  labels,
  dataLocale,
}: {
  pokemonQuery: string;
  moveQuery: string;
  activeTypes: Set<string>;
  onPokemonChange: (value: string) => void;
  onMoveChange: (value: string) => void;
  onToggleType: (type: string) => void;
  onClear: () => void;
  hasFilters: boolean;
  labels: MoveUsageTableLabels;
  dataLocale: DataLocale;
}) {
  return (
    <div className="rounded-poke-lg border border-poke-border bg-poke-surface p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-poke-text-secondary">
          <span>{labels.pokemon}</span>
          <input
            type="text"
            value={pokemonQuery}
            onChange={(e) => onPokemonChange(e.target.value)}
            placeholder={labels.searchPokemon}
            className="px-2 py-1 border border-poke-border rounded-poke-sm text-sm bg-poke-elevated text-poke-text-primary placeholder:text-poke-text-muted min-w-[12rem]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-poke-text-secondary">
          <span>{labels.move}</span>
          <input
            type="text"
            value={moveQuery}
            onChange={(e) => onMoveChange(e.target.value)}
            placeholder={labels.searchMoves}
            className="px-2 py-1 border border-poke-border rounded-poke-sm text-sm bg-poke-elevated text-poke-text-primary placeholder:text-poke-text-muted min-w-[12rem]"
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-poke-text-secondary hover:text-poke-text-primary underline ml-auto"
          >
            {labels.clearFilters}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ALL_TYPES.map((type) => {
          const active = activeTypes.has(type);
          const typeLabel = localizeType(type, dataLocale);
          return (
            <button
              key={type}
              type="button"
              onClick={() => onToggleType(type)}
              title={typeLabel}
              aria-label={typeLabel}
              aria-pressed={active}
              className={`rounded-poke-sm transition-all ${
                active
                  ? 'ring-2 ring-poke-accent ring-offset-2 ring-offset-poke-surface'
                  : 'opacity-60 hover:opacity-100'
              }`}
            >
              <TypeSprite type={type} size={14} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SubViewToggle({
  view,
  onChange,
  labels,
}: {
  view: SubView;
  onChange: (v: SubView) => void;
  labels: MoveUsageTableLabels;
}) {
  const options: { id: SubView; label: string }[] = [
    { id: 'by-pokemon', label: labels.byPokemon },
    { id: 'by-move', label: labels.byMove },
  ];

  return (
    <div className="inline-flex gap-1 p-1 bg-poke-elevated border border-poke-border rounded-poke-md">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`px-3 py-1.5 text-xs font-heading font-medium rounded-poke-sm transition-colors ${
            view === option.id
              ? 'bg-poke-accent text-poke-surface'
              : 'text-poke-text-secondary hover:bg-poke-border'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ByPokemonView({
  rows,
  totals,
  used,
  dataLocale,
}: {
  rows: MoveUsageRow[];
  totals: Map<string, MovePokemonTotals>;
  used: string;
  dataLocale: DataLocale;
}) {
  const byPokemon = useMemo(() => {
    const map = new Map<string, MoveUsageRow[]>();
    for (const row of rows) {
      const existing = map.get(row.pokemon_name) ?? [];
      existing.push(row);
      map.set(row.pokemon_name, existing);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const aTotal = totals.get(a[0])?.total_brought ?? sumCounts(a[1]);
      const bTotal = totals.get(b[0])?.total_brought ?? sumCounts(b[1]);
      return bTotal - aTotal;
    });
  }, [rows, totals]);

  return (
    <div className="space-y-3">
      {byPokemon.map(([pokemon, moves]) => {
        const totalBrought = totals.get(pokemon)?.total_brought ?? 0;
        return (
          <Card key={pokemon} variant="outlined" padding="sm">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <PokemonLink name={pokemon}>
                <PokemonSprite name={pokemon} size={28} />
                <h4 className="font-heading font-semibold text-sm text-poke-text-primary">
                  {localizeSpecies(pokemon, dataLocale)}
                </h4>
              </PokemonLink>
              {totalBrought > 0 && (
                <span className="text-xs text-poke-text-muted font-medium">
                  {used} {totalBrought}×
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {[...moves]
                .sort((a, b) => b.count - a.count)
                .map((m) => (
                  <MoveChip key={m.move_name} row={m} dataLocale={dataLocale} />
                ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ByMoveView({
  rows,
  used,
  dataLocale,
}: {
  rows: MoveUsageRow[];
  used: string;
  dataLocale: DataLocale;
}) {
  const byMove = useMemo(() => {
    const map = new Map<
      string,
      {
        move_name: string;
        move_type: string | null;
        move_category: 'Physical' | 'Special' | 'Status' | null;
        total: number;
        pokemon: { pokemon_name: string; count: number }[];
      }
    >();
    for (const row of rows) {
      const existing = map.get(row.move_name);
      if (existing) {
        existing.total += row.count;
        existing.pokemon.push({ pokemon_name: row.pokemon_name, count: row.count });
      } else {
        map.set(row.move_name, {
          move_name: row.move_name,
          move_type: row.move_type,
          move_category: row.move_category,
          total: row.count,
          pokemon: [{ pokemon_name: row.pokemon_name, count: row.count }],
        });
      }
    }
    const sortedMoves = Array.from(map.values()).sort((a, b) => b.total - a.total);
    for (const move of sortedMoves) {
      move.pokemon.sort((a, b) => b.count - a.count);
    }
    return sortedMoves;
  }, [rows]);

  return (
    <div className="space-y-3">
      {byMove.map((move) => (
        <Card key={move.move_name} variant="outlined" padding="sm">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="inline-flex items-center gap-2">
              {move.move_type && <TypeSprite type={move.move_type} size={14} />}
              <Link
                href={`/wiki/moves/${encodeURIComponent(move.move_name)}`}
                className="font-heading font-semibold text-sm text-poke-text-primary hover:text-poke-blue transition-colors"
              >
                {localizeMove(move.move_name, dataLocale)}
              </Link>
              {move.move_category && (
                <CategoryIcon category={move.move_category} size={16} />
              )}
            </div>
            <span className="text-xs text-poke-text-muted font-medium">
              {used} {move.total}×
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {move.pokemon.map((p) => (
              <PokemonChip
                key={`${move.move_name}-${p.pokemon_name}`}
                pokemon_name={p.pokemon_name}
                count={p.count}
                dataLocale={dataLocale}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function MoveChip({ row, dataLocale }: { row: MoveUsageRow; dataLocale: DataLocale }) {
  const name = localizeMove(row.move_name, dataLocale);
  return (
    <Link
      href={`/wiki/moves/${encodeURIComponent(row.move_name)}`}
      className="inline-flex items-center gap-1.5 px-2 py-1 bg-poke-muted hover:bg-poke-border rounded-poke-sm text-xs transition-colors"
      title={name}
    >
      {row.move_type && <TypeSprite type={row.move_type} size={12} />}
      <span className="font-medium text-poke-text-primary">{name}</span>
      {row.move_category && <CategoryIcon category={row.move_category} size={14} />}
      <span className="text-poke-text-muted">×{row.count}</span>
    </Link>
  );
}

function PokemonChip({
  pokemon_name,
  count,
  dataLocale,
}: {
  pokemon_name: string;
  count: number;
  dataLocale: DataLocale;
}) {
  const name = localizeSpecies(pokemon_name, dataLocale);
  return (
    <Link
      href={`/pokemon/${encodeURIComponent(pokemon_name)}`}
      className="inline-flex items-center gap-1.5 px-2 py-1 bg-poke-muted hover:bg-poke-border rounded-poke-sm text-xs transition-colors"
      title={name}
    >
      <PokemonSprite name={pokemon_name} size={20} />
      <span className="font-medium text-poke-text-primary">{name}</span>
      <span className="text-poke-text-muted">×{count}</span>
    </Link>
  );
}

function sumCounts(rows: MoveUsageRow[]): number {
  let s = 0;
  for (const r of rows) s += r.count;
  return s;
}
