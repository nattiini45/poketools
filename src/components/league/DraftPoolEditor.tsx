'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import type { DraftPoolEntry, DraftPoolTemplate, DraftPoolTemplateEntry } from '@/types/draft-pool';
import { POWER_TIERS, POWER_TIER_COLORS } from '@/types/evolution';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import { useDataLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraft, errorsDraftLegacy, errorsSeasons } from '@/i18n/messages/errors';
import { draftLegacyLeagueAdminMessages } from '@/i18n/messages/draft/legacy/league-admin';
import { draftLegacyLeagueAdminPoolMessages } from '@/i18n/messages/draft/legacy/league-admin/pool';
import type poolEn from '@/i18n/messages/draft/legacy/league-admin/pool/en';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { unsavedMarker } from '@/lib/league-admin/unsaved';
import { poolEditorDirty } from '@/lib/league-admin/form-dirty';

interface DraftPoolEditorProps {
  seasonId: string;
}

interface SearchResult {
  name: string;
  id: string;
}

/** Option values of the tier selects; '' = untiered. Labels are translated where they render. */
const TIER_VALUES: readonly string[] = ['', ...POWER_TIERS];

type PoolErrorKey = keyof typeof poolEn.poolEditor.errors;
/** A failed call keeps the API body (rendered via `useApiErrorText`); a local failure keeps a message key. */
type PoolError = { api: ApiErrorLike } | { key: PoolErrorKey };

/** The API body when it carries an error or code, else the local message key. */
function failure(json: unknown, key: PoolErrorKey): PoolError {
  const api = toApiErrorLike(json);
  return api.error || api.code ? { api } : { key };
}

/** The tier select's options: '—' for untiered, else "S-Tier". */
function TierOptions() {
  const tShared = useT(draftLegacyLeagueAdminMessages);
  return (
    <>
      {TIER_VALUES.map((value) => (
        <option key={value} value={value}>
          {value === '' ? '—' : tShared('tier', { tier: value })}
        </option>
      ))}
    </>
  );
}

export default function DraftPoolEditor({ seasonId }: DraftPoolEditorProps) {
  const [entries, setEntries] = useState<DraftPoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PoolError | null>(null);
  const t = useT(draftLegacyLeagueAdminPoolMessages);
  const tShared = useT(draftLegacyLeagueAdminMessages);
  const dl = useDataLocale();
  const apiErrorText = useApiErrorText(errorsDraftLegacy, errorsSeasons, errorsDraft);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addTier, setAddTier] = useState<string>('C');
  const [addCost, setAddCost] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedPokemon, setSelectedPokemon] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Bulk clear
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Inline edit tracking
  const [editingId, setEditingId] = useState<string | null>(null);

  // Template + CSV state
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const [templates, setTemplates] = useState<DraftPoolTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [csvImporting, setCsvImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const entryNames = new Set(entries.map((e) => e.pokemon_name.toLowerCase()));
  /** Typed or chosen input not written yet (league admin tab guard). Inline row edits save on change. */
  const dirty = poolEditorDirty({
    addFormOpen: showAddForm,
    searchQuery,
    selectedPokemon,
    addCost,
    templateName,
  });

  // ── Fetch entries ────────────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`/api/draft-pool-entries?season_id=${seasonId}`);
      const json = await res.json();
      if (json.success) setEntries(json.data);
      else setError(failure(json, 'loadEntries'));
    } catch (err) {
      console.error('[DraftPoolEditor] fetch entries failed:', err);
      setError({ key: 'loadEntries' });
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // ── Debounced search ─────────────────────────────────────────
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const debounce = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/pkmn/search?q=${encodeURIComponent(searchQuery)}&type=species`,
          { signal: controller.signal }
        );
        const json = await res.json();
        if (json.success) {
          // Filter out Pokemon already in the pool
          const filtered = (json.data as SearchResult[]).filter(
            (r) => !entryNames.has(r.name.toLowerCase())
          );
          setSearchResults(filtered);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
    // entryNames changes on every render; stringify for stable dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // ── Select a Pokemon from search results ─────────────────────
  function selectPokemon(result: SearchResult) {
    setSelectedPokemon(result.name);
    setSearchQuery('');
    setSearchResults([]);
  }

  // ── Add entry ────────────────────────────────────────────────
  async function handleAdd() {
    if (!selectedPokemon) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/draft-pool-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          pokemon_name: selectedPokemon,
          power_tier: addTier || null,
          point_cost: addCost !== '' ? addCost : null,
        }),
      });

      const json = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }

      setSelectedPokemon(null);
      setAddTier('C');
      setAddCost('');
      await fetchEntries();
      // Keep form open for rapid adding
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } catch (err) {
      console.error('[DraftPoolEditor] add entry failed:', err);
      setError({ key: 'addEntry' });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Inline edit ──────────────────────────────────────────────
  async function handleInlineEdit(
    entry: DraftPoolEntry,
    field: 'power_tier' | 'point_cost',
    value: string | number | null
  ) {
    setError(null);
    setEditingId(entry.id);

    try {
      const res = await fetch(`/api/draft-pool-entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });

      const json = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }

      // Update local state optimistically
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, [field]: value } : e))
      );
    } catch (err) {
      console.error('[DraftPoolEditor] inline edit failed:', err);
      setError({ key: 'updateEntry' });
    } finally {
      setEditingId(null);
    }
  }

  // ── Remove single entry ──────────────────────────────────────
  async function handleRemove(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/draft-pool-entries/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('[DraftPoolEditor] remove entry failed:', err);
      setError({ key: 'removeEntry' });
    }
  }

  // ── Bulk clear ───────────────────────────────────────────────
  async function handleClearAll() {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/draft-pool-entries?season_id=${seasonId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }
      setEntries([]);
      setConfirmClear(false);
    } catch (err) {
      console.error('[DraftPoolEditor] clear pool failed:', err);
      setError({ key: 'clearPool' });
    } finally {
      setClearing(false);
    }
  }

  // ── Templates ─────────────────────────────────────────────────
  async function fetchTemplates() {
    setLoadingTemplates(true);
    try {
      const res = await fetch('/api/draft-pool-templates');
      const json = await res.json();
      if (json.success) setTemplates(json.data);
      else setError(failure(json, 'loadTemplates'));
    } catch (err) {
      console.error('[DraftPoolEditor] fetch templates failed:', err);
      setError({ key: 'loadTemplates' });
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function handleSaveTemplate() {
    if (!templateName.trim() || entries.length === 0) return;
    setSavingTemplate(true);
    setError(null);
    try {
      const templateEntries: DraftPoolTemplateEntry[] = entries.map((e) => ({
        pokemon_name: e.pokemon_name,
        power_tier: e.power_tier,
        point_cost: e.point_cost,
      }));

      const res = await fetch('/api/draft-pool-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName.trim(),
          pool_mode: 'combined',
          entries: templateEntries,
        }),
      });

      const json = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }

      setTemplateName('');
      await fetchTemplates();
    } catch (err) {
      console.error('[DraftPoolEditor] save template failed:', err);
      setError({ key: 'saveTemplate' });
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleLoadTemplate(template: DraftPoolTemplate) {
    setError(null);
    try {
      // Bulk create entries from template, skipping any that already exist
      const newEntries = template.entries.filter(
        (e) => !entryNames.has(e.pokemon_name.toLowerCase())
      );

      if (newEntries.length === 0) {
        setError({ key: 'templateAllInPool' });
        return;
      }

      const res = await fetch('/api/draft-pool-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          newEntries.map((e) => ({
            season_id: seasonId,
            pokemon_name: e.pokemon_name,
            power_tier: e.power_tier ?? null,
            point_cost: e.point_cost ?? null,
          }))
        ),
      });

      const json = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }

      await fetchEntries();
      setShowTemplatePanel(false);
    } catch (err) {
      console.error('[DraftPoolEditor] load template failed:', err);
      setError({ key: 'loadTemplate' });
    }
  }

  async function handleDeleteTemplate(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/draft-pool-templates/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        setError(failure(json, 'deleteTemplate'));
        return;
      }
      setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
    } catch (err) {
      console.error('[DraftPoolEditor] delete template failed:', err);
      setError({ key: 'deleteTemplate' });
    }
  }

  // ── CSV Import ───────────────────────────────────────────────
  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvImporting(true);
    setError(null);

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());

      // Expect: pokemon_name,power_tier,point_cost (header optional)
      const startLine = /^pokemon/i.test(lines[0]) ? 1 : 0;
      const parsed: Array<{ pokemon_name: string; power_tier: string | null; point_cost: number | null }> = [];

      for (let i = startLine; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        if (!cols[0]) continue;
        parsed.push({
          pokemon_name: cols[0],
          power_tier: cols[1] && ['S', 'A', 'B', 'C'].includes(cols[1].toUpperCase())
            ? cols[1].toUpperCase()
            : null,
          point_cost: cols[2] && !isNaN(Number(cols[2])) ? Number(cols[2]) : null,
        });
      }

      if (parsed.length === 0) {
        setError({ key: 'csvEmpty' });
        return;
      }

      // Filter out duplicates with existing pool
      const newEntries = parsed.filter(
        (p) => !entryNames.has(p.pokemon_name.toLowerCase())
      );

      if (newEntries.length === 0) {
        setError({ key: 'csvAllInPool' });
        return;
      }

      const res = await fetch('/api/draft-pool-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          newEntries.map((p) => ({
            season_id: seasonId,
            ...p,
          }))
        ),
      });

      const json = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }

      await fetchEntries();
    } catch (err) {
      console.error('[DraftPoolEditor] CSV import failed:', err);
      setError({ key: 'csvImport' });
    } finally {
      setCsvImporting(false);
      // Reset the file input
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  }

  // ── Group entries by tier ────────────────────────────────────
  const tierGroups: Record<string, DraftPoolEntry[]> = { S: [], A: [], B: [], C: [], '': [] };
  for (const entry of entries) {
    const key = entry.power_tier ?? '';
    if (!tierGroups[key]) tierGroups[key] = [];
    tierGroups[key].push(entry);
  }

  if (loading) return <p className="text-sm text-poke-text-muted">{t('poolEditor.loading')}</p>;

  const errorText = error
    ? 'api' in error
      ? apiErrorText(error.api)
      : t(`poolEditor.errors.${error.key}`)
    : null;

  return (
    <div className="space-y-4" {...unsavedMarker(dirty)}>
      {errorText && <Alert variant="error">{errorText}</Alert>}

      {/* ── Header with actions ──────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-poke-text-muted">
            {t('poolEditor.intro')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-poke-danger">
                  {t('poolEditor.clearConfirm', { count: entries.length })}
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleClearAll}
                  loading={clearing}
                >
                  {t('poolEditor.confirm')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmClear(false)}
                >
                  {t('poolEditor.cancel')}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClear(true)}
              >
                {t('poolEditor.clearAll')}
              </Button>
            )
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setSelectedPokemon(null);
              setSearchQuery('');
              if (!showAddForm) setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
          >
            {showAddForm ? t('poolEditor.doneAdding') : t('poolEditor.addPokemon')}
          </Button>
        </div>
      </div>

      {/* ── Add Pokémon form ─────────────────────────────────── */}
      {showAddForm && (
        <Card variant="muted" padding="md">
          <div className="space-y-3">
            <h4 className="text-sm font-heading font-semibold text-poke-text-primary">
              {t('poolEditor.addTitle')}
            </h4>

            {!selectedPokemon ? (
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('poolEditor.searchPlaceholder')}
                  className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-3 py-2 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                />

                {(searchResults.length > 0 || searching) && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-poke-surface border border-poke-border rounded-poke-md shadow-poke-card max-h-60 overflow-y-auto">
                    {searching && (
                      <div className="px-3 py-2 text-sm text-poke-text-muted">{t('poolEditor.searching')}</div>
                    )}
                    {searchResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => selectPokemon(r)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-poke-elevated transition-colors text-sm"
                      >
                        <PokemonSprite name={r.name} size={28} />
                        <span className="text-poke-text-primary font-medium">{localizeSpecies(r.name, dl)}</span>
                      </button>
                    ))}
                    {!searching && searchResults.length === 0 && searchQuery.length >= 2 && (
                      <div className="px-3 py-2 text-sm text-poke-text-muted">
                        {t('poolEditor.noResults')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Selected Pokemon preview */}
                <div className="flex items-center gap-3 p-3 bg-poke-elevated rounded-poke-md">
                  <PokemonSprite name={selectedPokemon} size={36} />
                  <span className="font-medium text-poke-text-primary text-sm">
                    {localizeSpecies(selectedPokemon, dl)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPokemon(null);
                      setTimeout(() => searchInputRef.current?.focus(), 50);
                    }}
                    className="ml-auto text-xs text-poke-danger hover:underline"
                  >
                    {t('poolEditor.change')}
                  </button>
                </div>

                {/* Tier + Cost inputs */}
                <div className="flex items-end gap-3">
                  <div>
                    <label className="block text-xs font-heading font-semibold text-poke-text-primary mb-1">
                      {t('poolEditor.powerTier')}
                    </label>
                    <select
                      value={addTier}
                      onChange={(e) => setAddTier(e.target.value)}
                      className="border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1.5 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                    >
                      <TierOptions />
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-heading font-semibold text-poke-text-primary mb-1">
                      {t('poolEditor.pointCost')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={addCost}
                      onChange={(e) =>
                        setAddCost(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      placeholder="—"
                      className="w-20 border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1.5 text-sm text-poke-text-primary text-center focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleAdd}
                    loading={submitting}
                  >
                    {t('poolEditor.addToPool')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Pool entries grouped by tier ─────────────────────── */}
      {entries.length === 0 && !showAddForm ? (
        <p className="text-sm text-poke-text-muted">
          {t('poolEditor.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {/* Tiered groups */}
          {POWER_TIERS.map((pt) => {
            const group = tierGroups[pt];
            if (!group || group.length === 0) return null;
            const colors = POWER_TIER_COLORS[pt];

            return (
              <div key={pt} className={`border ${colors.border} rounded-poke-lg overflow-hidden`}>
                <div className={`px-3 py-1.5 ${colors.bg} flex items-center gap-2`}>
                  <span className={`font-heading font-bold text-sm ${colors.text}`}>
                    {tShared('tier', { tier: pt })}
                  </span>
                  <span className="text-xs text-poke-text-muted">
                    {tShared('pokemonCount', { count: group.length })}
                  </span>
                </div>
                <div className="divide-y divide-poke-border">
                  {group.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      editing={editingId === entry.id}
                      onEditTier={(val) => handleInlineEdit(entry, 'power_tier', val || null)}
                      onEditCost={(val) => handleInlineEdit(entry, 'point_cost', val)}
                      onRemove={() => handleRemove(entry.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Untiered group */}
          {tierGroups[''] && tierGroups[''].length > 0 && (
            <div className="border border-poke-border rounded-poke-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-poke-elevated flex items-center gap-2">
                <span className="font-heading font-bold text-sm text-poke-text-secondary">
                  {t('poolEditor.untiered')}
                </span>
                <span className="text-xs text-poke-text-muted">
                  {tShared('pokemonCount', { count: tierGroups[''].length })}
                </span>
              </div>
              <div className="divide-y divide-poke-border">
                {tierGroups[''].map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    editing={editingId === entry.id}
                    onEditTier={(val) => handleInlineEdit(entry, 'power_tier', val || null)}
                    onEditCost={(val) => handleInlineEdit(entry, 'point_cost', val)}
                    onRemove={() => handleRemove(entry.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Summary ─────────────────────────────────────────── */}
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-poke-text-muted">
          <span>
            {t.rich('poolEditor.summaryTotal', {
              count: entries.length,
              b: (chunks) => <strong className="text-poke-text-primary">{chunks}</strong>,
            })}
          </span>
          {POWER_TIERS.map((pt) => {
            const count = tierGroups[pt]?.length ?? 0;
            if (count === 0) return null;
            const colors = POWER_TIER_COLORS[pt];
            return (
              <span key={pt}>
                &middot;{' '}
                {t.rich('poolEditor.summaryTier', {
                  count,
                  tier: pt,
                  b: (chunks) => <strong className={colors.text}>{chunks}</strong>,
                })}
              </span>
            );
          })}
          {(tierGroups['']?.length ?? 0) > 0 && (
            <span>
              &middot;{' '}
              {t.rich('poolEditor.summaryUntiered', {
                count: tierGroups[''].length,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </span>
          )}
        </div>
      )}

      {/* ── Templates + CSV Import ──────────────────────────── */}
      <div className="pt-4 border-t border-poke-border">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowTemplatePanel(!showTemplatePanel);
              if (!showTemplatePanel) fetchTemplates();
            }}
          >
            {showTemplatePanel ? t('poolEditor.hideTemplates') : t('poolEditor.templates')}
          </Button>

          <label className="cursor-pointer">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => csvInputRef.current?.click()}
              loading={csvImporting}
            >
              {t('poolEditor.importCsv')}
            </Button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={handleCsvImport}
              className="hidden"
            />
          </label>

          <span className="text-xs text-poke-text-muted">
            {t('poolEditor.csvFormat')}
          </span>
        </div>

        {showTemplatePanel && (
          <Card variant="muted" padding="md" className="mt-3">
            <div className="space-y-4">
              {/* Save current pool as template */}
              {entries.length > 0 && (
                <div>
                  <h4 className="text-sm font-heading font-semibold text-poke-text-primary mb-2">
                    {t('poolEditor.saveAsTemplate')}
                  </h4>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder={t('poolEditor.templateNamePlaceholder')}
                      className="flex-1 border border-poke-border bg-poke-surface rounded-poke-md px-3 py-1.5 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSaveTemplate}
                      loading={savingTemplate}
                      disabled={!templateName.trim()}
                    >
                      {t('poolEditor.save')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Load from template */}
              <div>
                <h4 className="text-sm font-heading font-semibold text-poke-text-primary mb-2">
                  {t('poolEditor.loadTemplate')}
                </h4>
                {loadingTemplates ? (
                  <p className="text-sm text-poke-text-muted">{t('poolEditor.loadingTemplates')}</p>
                ) : templates.length === 0 ? (
                  <p className="text-sm text-poke-text-muted">{t('poolEditor.noTemplates')}</p>
                ) : (
                  <div className="space-y-2">
                    {templates.map((tpl) => (
                      <div
                        key={tpl.id}
                        className="flex items-center justify-between p-2 bg-poke-elevated rounded-poke-md"
                      >
                        <div>
                          <span className="text-sm font-medium text-poke-text-primary">
                            {tpl.name}
                          </span>
                          <span className="text-xs text-poke-text-muted ml-2">
                            {tShared('pokemonCount', { count: tpl.entries.length })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleLoadTemplate(tpl)}
                          >
                            {t('poolEditor.load')}
                          </Button>
                          <button
                            onClick={() => handleDeleteTemplate(tpl.id)}
                            className="text-xs text-poke-danger hover:underline"
                          >
                            {t('poolEditor.delete')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Entry Row ────────────────────────────────────────────────────
interface EntryRowProps {
  entry: DraftPoolEntry;
  editing: boolean;
  onEditTier: (tier: string) => void;
  onEditCost: (cost: number | null) => void;
  onRemove: () => void;
}

function EntryRow({ entry, editing, onEditTier, onEditCost, onRemove }: EntryRowProps) {
  const t = useT(draftLegacyLeagueAdminPoolMessages);
  const dl = useDataLocale();
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-poke-elevated transition-colors">
      <PokemonSprite name={entry.pokemon_name} size={28} />
      <span className="font-medium text-sm text-poke-text-primary min-w-[120px]">
        {localizeSpecies(entry.pokemon_name, dl)}
      </span>

      {/* Inline tier edit */}
      <select
        value={entry.power_tier ?? ''}
        onChange={(e) => onEditTier(e.target.value)}
        disabled={editing}
        className="border border-poke-border bg-poke-surface rounded-poke-md px-1.5 py-1 text-xs text-poke-text-primary focus:border-poke-border-focus transition-colors disabled:opacity-50"
      >
        <TierOptions />
      </select>

      {/* Inline cost edit */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-poke-text-muted">{t('poolEditor.cost')}</span>
        <input
          type="number"
          min={0}
          value={entry.point_cost ?? ''}
          onChange={(e) =>
            onEditCost(e.target.value === '' ? null : Number(e.target.value))
          }
          disabled={editing}
          placeholder="—"
          className="w-14 border border-poke-border bg-poke-surface rounded-poke-md px-1.5 py-1 text-xs text-poke-text-primary text-center focus:border-poke-border-focus transition-colors disabled:opacity-50"
        />
      </div>

      <button
        onClick={onRemove}
        className="ml-auto text-xs text-poke-danger hover:underline"
      >
        {t('poolEditor.remove')}
      </button>
    </div>
  );
}
