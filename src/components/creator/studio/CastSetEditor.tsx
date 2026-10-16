'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getSpriteUrl } from '@/lib/pkmn/sprites';
import type { PokemonSet, StatSpread } from '@/types/team';
import { useDataLocale, useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove, moveSearchKeys } from '@/lib/pkmn/i18n/names/moves';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeMoveCategory, localizeNature, localizeStat, localizeType } from '@/lib/pkmn/i18n/names/misc';
import { rankedSearch } from '@/lib/pkmn/i18n/search';
import type { MoveCategory } from '@/lib/pkmn/i18n/types';

function isMoveCategory(value: string): value is MoveCategory {
  return value === 'Physical' || value === 'Special' || value === 'Status';
}

// ─── Sub-picker: species search ────────────────────────────────────

function SpeciesPicker({ onSelect, onCancel }: { onSelect: (species: string) => void; onCancel: () => void }) {
  const t = useT(creatorStudioMessages);
  const dataLocale = useDataLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ name: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // The search API matches English and German names; results keep the English name as the value.
  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/pkmn/search?type=species&q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (json.success) setResults(json.data.slice(0, 12));
    }, 200);
  }, []);

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder={t('setEditor.searchSpecies')}
        className="w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-1.5 text-sm text-poke-text-primary focus:outline-none focus:ring-1 focus:ring-poke-accent"
      />
      {results.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {results.map((r) => (
            <button
              key={r.name}
              onClick={() => onSelect(r.name)}
              className="flex items-center gap-2 w-full px-2 py-1 text-left text-sm text-poke-text-primary hover:bg-poke-accent/10 rounded"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={getSpriteUrl(r.name)} alt="" className="w-6 h-6" />
              {localizeSpecies(r.name, dataLocale)}
            </button>
          ))}
        </div>
      )}
      <button onClick={onCancel} className="text-xs text-poke-text-secondary hover:text-poke-accent">
        {t('setEditor.cancel')}
      </button>
    </div>
  );
}

// ─── Sub-picker: move search ───────────────────────────────────────

function MoveSearchPicker({ species, generation, onSelect, onCancel }: {
  species: string;
  generation: number;
  onSelect: (move: string) => void;
  onCancel: () => void;
}) {
  const t = useT(creatorStudioMessages);
  const dataLocale = useDataLocale();
  const [query, setQuery] = useState('');
  const [allMoves, setAllMoves] = useState<{ name: string; type: string; basePower: number; category: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    fetch(`/api/pkmn/moves/${encodeURIComponent(species)}?gen=${generation}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setAllMoves(json.data);
      })
      .catch(() => { /* ignore */ });
  }, [species, generation]);

  // Matches English, German and transliterated names (pkmn-l10n search).
  const moves = useMemo(() => {
    if (!query) return allMoves.slice(0, 20);
    return rankedSearch(allMoves, query, (m) => moveSearchKeys(m.name), { limit: 20 });
  }, [query, allMoves]);

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('setEditor.searchMoves')}
        className="w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-1.5 text-sm text-poke-text-primary focus:outline-none focus:ring-1 focus:ring-poke-accent"
      />
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {moves.map((m) => (
          <button
            key={m.name}
            onClick={() => onSelect(m.name)}
            className="flex items-center justify-between w-full px-2 py-1 text-left text-sm text-poke-text-primary hover:bg-poke-accent/10 rounded"
          >
            <span>{localizeMove(m.name, dataLocale)}</span>
            <span className="text-xs text-poke-text-secondary">
              {isMoveCategory(m.category) ? localizeMoveCategory(m.category, dataLocale) : m.category}{' '}
              {m.basePower > 0 ? m.basePower : ''}
            </span>
          </button>
        ))}
      </div>
      <button onClick={onCancel} className="text-xs text-poke-text-secondary hover:text-poke-accent">
        {t('setEditor.cancel')}
      </button>
    </div>
  );
}

// ─── Sub-picker: generic search (items, abilities) ─────────────────

function GenericPicker({ type, species, generation, onSelect, onCancel }: {
  type: 'item' | 'ability';
  species?: string;
  generation: number;
  onSelect: (value: string) => void;
  onCancel: () => void;
}) {
  const t = useT(creatorStudioMessages);
  const dataLocale = useDataLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ name: string }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // For abilities, if species is provided, load legal abilities first
  useEffect(() => {
    if (type === 'ability' && species) {
      fetch(`/api/pkmn/search?type=ability&q=&species=${encodeURIComponent(species)}&gen=${generation}`)
        .then((r) => r.json())
        .then((json) => { if (json.success) setResults(json.data.slice(0, 10)); })
        .catch(() => { /* ignore */ });
    }
  }, [type, species, generation]);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2 && type === 'item') { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/pkmn/search?type=${type}&q=${encodeURIComponent(q)}&gen=${generation}`);
      const json = await res.json();
      if (json.success) setResults(json.data.slice(0, 12));
    }, 200);
  }, [type, generation]);

  const display = type === 'item' ? localizeItem : localizeAbility;

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder={type === 'item' ? t('setEditor.searchItems') : t('setEditor.searchAbilities')}
        className="w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-1.5 text-sm text-poke-text-primary focus:outline-none focus:ring-1 focus:ring-poke-accent"
      />
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {results.map((r) => (
          <button
            key={r.name}
            onClick={() => onSelect(r.name)}
            className="w-full px-2 py-1 text-left text-sm text-poke-text-primary hover:bg-poke-accent/10 rounded"
          >
            {display(r.name, dataLocale)}
          </button>
        ))}
      </div>
      <button onClick={onCancel} className="text-xs text-poke-text-secondary hover:text-poke-accent">
        {t('setEditor.cancel')}
      </button>
    </div>
  );
}

// ─── Nature constants (English keys; labels come from the pkmn layer) ──

const NATURES = [
  'Adamant', 'Bashful', 'Bold', 'Brave', 'Calm',
  'Careful', 'Docile', 'Gentle', 'Hardy', 'Hasty',
  'Impish', 'Jolly', 'Lax', 'Lonely', 'Mild',
  'Modest', 'Naive', 'Naughty', 'Quiet', 'Quirky',
  'Rash', 'Relaxed', 'Sassy', 'Serious', 'Timid',
] as const;

const TERA_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic',
  'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy', 'Stellar',
] as const;

const STAT_KEYS: (keyof StatSpread)[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

// ─── Main CastSetEditor ───────────────────────────────────────────

interface CastSetEditorProps {
  set: PokemonSet;
  slotIndex: number;
  generation: number;
  format: string;
  onUpdate: (update: Partial<PokemonSet>) => void;
  onClose: () => void;
}

type EditingField = 'species' | 'move0' | 'move1' | 'move2' | 'move3' | 'item' | 'ability' | null;

export default function CastSetEditor({ set, slotIndex, generation, format: _format, onUpdate, onClose }: CastSetEditorProps) {
  const t = useT(creatorStudioMessages);
  const dataLocale = useDataLocale();
  const [editing, setEditing] = useState<EditingField>(set.species ? null : 'species');

  // Stored values stay English; only the rendered labels are localized.
  const natureOptions = useMemo(
    () => NATURES.map((n) => ({ value: n, label: localizeNature(n, dataLocale) })),
    [dataLocale],
  );
  const teraOptions = useMemo(
    () => TERA_TYPES.map((type) => ({ value: type, label: localizeType(type, dataLocale) })),
    [dataLocale],
  );

  const handleSpeciesSelect = (species: string) => {
    onUpdate({ species, name: '', moves: [], item: '', ability: '', nature: 'Hardy' });
    setEditing(null);
  };

  const handleMoveSelect = (moveIndex: number, move: string) => {
    const newMoves = [...set.moves];
    newMoves[moveIndex] = move;
    onUpdate({ moves: newMoves });
    setEditing(null);
  };

  const handleEvChange = (stat: keyof StatSpread, value: number) => {
    const newEvs = { ...set.evs, [stat]: Math.max(0, Math.min(252, value)) };
    // Enforce 510 total cap
    const total = Object.values(newEvs).reduce((sum, v) => sum + v, 0);
    if (total > 510) return;
    onUpdate({ evs: newEvs });
  };

  const speciesLabel = set.species ? localizeSpecies(set.species, dataLocale) : '';

  return (
    <div className="rounded-poke-lg border border-poke-border bg-poke-surface p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {set.species && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getSpriteUrl(set.species)} alt={speciesLabel} className="w-10 h-10" />
          )}
          <span className="font-heading font-bold text-poke-text-primary">
            {t('setEditor.slotTitle', { n: slotIndex + 1, species: speciesLabel || t('setEditor.empty') })}
          </span>
        </div>
        <button onClick={onClose} className="text-xs text-poke-text-secondary hover:text-poke-accent">
          {t('setEditor.close')}
        </button>
      </div>

      {/* Active picker overlay */}
      {editing === 'species' && (
        <SpeciesPicker onSelect={handleSpeciesSelect} onCancel={() => setEditing(null)} />
      )}
      {editing?.startsWith('move') && set.species && (
        <MoveSearchPicker
          species={set.species}
          generation={generation}
          onSelect={(move) => handleMoveSelect(parseInt(editing[4]), move)}
          onCancel={() => setEditing(null)}
        />
      )}
      {editing === 'item' && (
        <GenericPicker type="item" generation={generation} onSelect={(item) => { onUpdate({ item }); setEditing(null); }} onCancel={() => setEditing(null)} />
      )}
      {editing === 'ability' && (
        <GenericPicker type="ability" species={set.species} generation={generation} onSelect={(ability) => { onUpdate({ ability }); setEditing(null); }} onCancel={() => setEditing(null)} />
      )}

      {/* Fields (shown when no picker is active) */}
      {!editing && set.species && (
        <div className="space-y-2">
          {/* Species */}
          <button onClick={() => setEditing('species')} className="text-xs text-poke-accent hover:underline">
            {t('setEditor.changeSpecies')}
          </button>

          {/* Item + Ability row */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setEditing('item')}
              className="rounded-poke-md border border-poke-border px-2 py-1.5 text-left text-sm text-poke-text-primary hover:border-poke-accent/50"
            >
              <span className="text-xs text-poke-text-secondary block">{t('setEditor.item')}</span>
              {set.item ? localizeItem(set.item, dataLocale) : t('setEditor.none')}
            </button>
            <button
              onClick={() => setEditing('ability')}
              className="rounded-poke-md border border-poke-border px-2 py-1.5 text-left text-sm text-poke-text-primary hover:border-poke-accent/50"
            >
              <span className="text-xs text-poke-text-secondary block">{t('setEditor.ability')}</span>
              {set.ability ? localizeAbility(set.ability, dataLocale) : t('setEditor.none')}
            </button>
          </div>

          {/* Moves (4 slots) */}
          <div className="grid grid-cols-2 gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <button
                key={i}
                onClick={() => setEditing(`move${i}` as EditingField)}
                className="rounded-poke-md border border-poke-border px-2 py-1 text-left text-sm text-poke-text-primary hover:border-poke-accent/50"
              >
                <span className="text-xs text-poke-text-secondary">{t('setEditor.move', { n: i + 1 })}</span>{' '}
                {set.moves[i] ? localizeMove(set.moves[i], dataLocale) : '—'}
              </button>
            ))}
          </div>

          {/* Nature */}
          <div>
            <label className="text-xs text-poke-text-secondary block mb-1">{t('setEditor.nature')}</label>
            <select
              value={set.nature}
              onChange={(e) => onUpdate({ nature: e.target.value })}
              className="w-full rounded-poke-md border border-poke-border bg-poke-surface px-2 py-1 text-sm text-poke-text-primary"
            >
              {natureOptions.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
            </select>
          </div>

          {/* Tera Type */}
          {generation >= 9 && (
            <div>
              <label className="text-xs text-poke-text-secondary block mb-1">{t('setEditor.teraType')}</label>
              <select
                value={set.tera_type ?? ''}
                onChange={(e) => onUpdate({ tera_type: e.target.value || undefined })}
                className="w-full rounded-poke-md border border-poke-border bg-poke-surface px-2 py-1 text-sm text-poke-text-primary"
              >
                <option value="">{t('setEditor.none')}</option>
                {teraOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {/* EVs (compact sliders) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-poke-text-secondary">{t('setEditor.evs')}</label>
              <span className="text-xs text-poke-text-secondary">
                {Object.values(set.evs).reduce((s, v) => s + v, 0)} / 510
              </span>
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1">
              {STAT_KEYS.map((stat) => (
                <div key={stat} className="flex items-center gap-1">
                  <span className="text-xs text-poke-text-secondary min-w-[1.5rem]">{localizeStat(stat, dataLocale, 'short')}</span>
                  <input
                    type="number"
                    min={0}
                    max={252}
                    step={4}
                    value={set.evs[stat]}
                    onChange={(e) => handleEvChange(stat, parseInt(e.target.value) || 0)}
                    className="w-14 rounded border border-poke-border bg-poke-surface px-1 py-0.5 text-xs text-poke-text-primary text-center"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
