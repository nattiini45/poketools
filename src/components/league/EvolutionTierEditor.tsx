'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import type { EvolutionTier, EvolutionTierFormData, PowerTier } from '@/types/evolution';
import { POWER_TIERS, POWER_TIER_COLORS } from '@/types/evolution';
import type { Player } from '@/types/player';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import { useDataLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraft, errorsDraftLegacy, errorsSeasons } from '@/i18n/messages/errors';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { draftLegacyLeagueAdminMessages } from '@/i18n/messages/draft/legacy/league-admin';
import { draftLegacyLeagueAdminEvolutionMessages } from '@/i18n/messages/draft/legacy/league-admin/evolution';
import type evolutionEn from '@/i18n/messages/draft/legacy/league-admin/evolution/en';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { formatPack } from '@/lib/format-pack';

interface EvolutionTierEditorProps {
  seasonId: string;
  /** All participants in the league (for wildcard assignment); only id and name are read. */
  participants: Pick<Player, 'id' | 'name'>[];
}

type TierErrorKey = keyof typeof evolutionEn.tierEditor.errors;
/** A failed call keeps the API body (rendered via `useApiErrorText`); a local failure keeps a message key. */
type TierError = { api: ApiErrorLike } | { key: TierErrorKey };

/**
 * Example species in the search hints (format pack `draftFormat.hintSpecies`); canonical English
 * names, shown through the pkmn layer.
 */
const [SEARCH_EXAMPLE_SPECIES, WILDCARD_EXAMPLE_SPECIES] = formatPack.draftFormat.hintSpecies;
/** New-tier and new-wildcard form defaults (format pack `draftFormat`). */
const NEW_TIER = formatPack.draftFormat.newTier;
const NEW_WILDCARD = formatPack.draftFormat.newWildcard;

interface EvoChainSearchResult {
  name: string;
  id: string;
  stage2: string;
  stage3: string;
}

interface ResolvedChain {
  base: string;
  stage2: string;
  stage3: string;
}

export default function EvolutionTierEditor({
  seasonId,
  participants,
}: EvolutionTierEditorProps) {
  const [tiers, setTiers] = useState<EvolutionTier[]>([]);
  const [wildcards, setWildcards] = useState<EvolutionTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TierError | null>(null);
  const t = useT(draftLegacyLeagueAdminEvolutionMessages);
  const tShared = useT(draftLegacyLeagueAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const dl = useDataLocale();
  const apiErrorText = useApiErrorText(errorsDraftLegacy, errorsSeasons, errorsDraft);

  // Add-tier form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EvoChainSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedChain, setSelectedChain] = useState<ResolvedChain | null>(null);
  const [stage2Kos, setStage2Kos] = useState(NEW_TIER.stage2Kos);
  const [stage3Kos, setStage3Kos] = useState(NEW_TIER.stage3Kos);
  const [powerTier, setPowerTier] = useState<PowerTier>(NEW_TIER.tier);
  const [submitting, setSubmitting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Wildcard form state
  const [showWildcardForm, setShowWildcardForm] = useState(false);
  const [wildcardSearch, setWildcardSearch] = useState('');
  const [wildcardResults, setWildcardResults] = useState<EvoChainSearchResult[]>([]);
  const [wildcardSearching, setWildcardSearching] = useState(false);
  const [wildcardChain, setWildcardChain] = useState<ResolvedChain | null>(null);
  const [wildcardStage2Kos, setWildcardStage2Kos] = useState(NEW_WILDCARD.stage2Kos);
  const [wildcardStage3Kos, setWildcardStage3Kos] = useState(NEW_WILDCARD.stage3Kos);
  const [wildcardPlayerId, setWildcardPlayerId] = useState('');
  const [wildcardSubmitting, setWildcardSubmitting] = useState(false);

  const fetchTiers = useCallback(async () => {
    try {
      const [tiersRes, wildcardsRes] = await Promise.all([
        fetch(`/api/evolutions?season_id=${seasonId}&type=tiers`).then((r) => r.json()),
        fetch(`/api/evolutions?season_id=${seasonId}&type=wildcards`).then((r) => r.json()),
      ]);

      if (tiersRes.success) setTiers(tiersRes.data);
      if (wildcardsRes.success) setWildcards(wildcardsRes.data);
    } catch {
      setError({ key: 'load' });
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    fetchTiers();
  }, [fetchTiers]);

  // Search for base-form Pokémon with 3-stage evo chains
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
          `/api/pkmn/evo-chain?q=${encodeURIComponent(searchQuery)}`,
          { signal: controller.signal }
        );
        const json = await res.json();
        if (json.success) setSearchResults(json.data);
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
  }, [searchQuery]);

  // Wildcard search
  useEffect(() => {
    if (wildcardSearch.length < 2) {
      setWildcardResults([]);
      return;
    }
    const controller = new AbortController();
    const debounce = setTimeout(async () => {
      setWildcardSearching(true);
      try {
        const res = await fetch(
          `/api/pkmn/evo-chain?q=${encodeURIComponent(wildcardSearch)}`,
          { signal: controller.signal }
        );
        const json = await res.json();
        if (json.success) setWildcardResults(json.data);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      } finally {
        setWildcardSearching(false);
      }
    }, 200);
    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [wildcardSearch]);

  function selectChain(result: EvoChainSearchResult) {
    setSelectedChain({ base: result.name, stage2: result.stage2, stage3: result.stage3 });
    setSearchQuery('');
    setSearchResults([]);
  }

  function selectWildcardChain(result: EvoChainSearchResult) {
    setWildcardChain({ base: result.name, stage2: result.stage2, stage3: result.stage3 });
    setWildcardSearch('');
    setWildcardResults([]);
  }

  async function handleAddTier(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChain) return;
    setSubmitting(true);
    setError(null);

    try {
      const body: EvolutionTierFormData = {
        season_id: seasonId,
        base_pokemon: selectedChain.base,
        stage2_pokemon: selectedChain.stage2,
        stage2_kos: stage2Kos,
        stage3_pokemon: selectedChain.stage3,
        stage3_kos: stage3Kos,
        power_tier: powerTier,
      };

      const res = await fetch('/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }

      setSelectedChain(null);
      setStage2Kos(NEW_TIER.stage2Kos);
      setStage3Kos(NEW_TIER.stage3Kos);
      setPowerTier(NEW_TIER.tier);
      setShowAddForm(false);
      await fetchTiers();
    } catch {
      setError({ key: 'addTier' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddWildcard(e: React.FormEvent) {
    e.preventDefault();
    if (!wildcardChain) return;
    setWildcardSubmitting(true);
    setError(null);

    try {
      const body: EvolutionTierFormData = {
        season_id: seasonId,
        player_id: wildcardPlayerId,
        base_pokemon: wildcardChain.base,
        stage2_pokemon: wildcardChain.stage2,
        stage2_kos: wildcardStage2Kos,
        stage3_pokemon: wildcardChain.stage3,
        stage3_kos: wildcardStage3Kos,
      };

      const res = await fetch('/api/evolutions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }

      setWildcardChain(null);
      setWildcardPlayerId('');
      setWildcardStage2Kos(NEW_WILDCARD.stage2Kos);
      setWildcardStage3Kos(NEW_WILDCARD.stage3Kos);
      setShowWildcardForm(false);
      await fetchTiers();
    } catch {
      setError({ key: 'addWildcard' });
    } finally {
      setWildcardSubmitting(false);
    }
  }

  async function handleDeleteTier(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/evolutions/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      await fetchTiers();
    } catch {
      setError({ key: 'removeTier' });
    }
  }

  if (loading) return <p className="text-sm text-poke-text-muted">{t('tierEditor.loading')}</p>;

  const errorText = error
    ? 'api' in error
      ? apiErrorText(error.api)
      : t(`tierEditor.errors.${error.key}`)
    : null;
  const species = (name: string) => localizeSpecies(name, dl);

  // Group tiers by power tier
  const tiersByPower: Record<PowerTier, EvolutionTier[]> = { S: [], A: [], B: [], C: [] };
  for (const tier of tiers) {
    const pt = (tier.power_tier || 'C') as PowerTier;
    if (tiersByPower[pt]) tiersByPower[pt].push(tier);
  }

  return (
    <div className="space-y-6">
      {errorText && <Alert variant="error">{errorText}</Alert>}

      {/* ── Tier List (grouped by power tier) ──────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading font-semibold text-lg text-poke-text-primary">{t('tierEditor.title')}</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowAddForm(!showAddForm);
              if (!showAddForm) setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
          >
            {showAddForm ? t('tierEditor.cancel') : t('tierEditor.addPokemon')}
          </Button>
        </div>

        {tiers.length === 0 && !showAddForm ? (
          <p className="text-sm text-poke-text-muted">
            {t('tierEditor.empty')}
          </p>
        ) : (
          <div className="space-y-4">
            {POWER_TIERS.map((pt) => {
              const tiersInGroup = tiersByPower[pt];
              if (tiersInGroup.length === 0) return null;
              const colors = POWER_TIER_COLORS[pt];
              return (
                <div key={pt} className={`border ${colors.border} rounded-poke-lg overflow-hidden`}>
                  <div className={`px-3 py-1.5 ${colors.bg} flex items-center gap-2`}>
                    <span className={`font-heading font-bold text-sm ${colors.text}`}>
                      {tShared('tier', { tier: pt })}
                    </span>
                    <span className="text-xs text-poke-text-muted">
                      {tShared('pokemonCount', { count: tiersInGroup.length })}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-poke-elevated">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-heading font-semibold text-poke-text-secondary">{tGlossary('roster.base')}</th>
                        <th className="px-3 py-1.5 text-left font-heading font-semibold text-poke-text-secondary">{tGlossary('roster.stage2')}</th>
                        <th className="px-3 py-1.5 text-center font-heading font-semibold text-poke-text-secondary">{t('tierEditor.kos')}</th>
                        <th className="px-3 py-1.5 text-left font-heading font-semibold text-poke-text-secondary">{tGlossary('roster.stage3')}</th>
                        <th className="px-3 py-1.5 text-center font-heading font-semibold text-poke-text-secondary">{t('tierEditor.kos')}</th>
                        <th className="px-3 py-1.5 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-poke-border">
                      {tiersInGroup.map((tier) => (
                        <tr key={tier.id} className="hover:bg-poke-elevated transition-colors">
                          <td className="px-3 py-2 text-poke-text-primary">
                            <span className="inline-flex items-center gap-1.5">
                              <PokemonSprite name={tier.base_pokemon} size={24} />
                              {species(tier.base_pokemon)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-poke-text-primary">
                            <span className="inline-flex items-center gap-1.5">
                              <PokemonSprite name={tier.stage2_pokemon} size={24} />
                              {species(tier.stage2_pokemon)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-poke-text-primary">{tier.stage2_kos}</td>
                          <td className="px-3 py-2 text-poke-text-primary">
                            {tier.stage3_pokemon ? (
                              <span className="inline-flex items-center gap-1.5">
                                <PokemonSprite name={tier.stage3_pokemon} size={24} />
                                {species(tier.stage3_pokemon)}
                              </span>
                            ) : (
                              <span className="text-poke-text-muted">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-poke-text-primary">
                            {tier.stage3_kos ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => handleDeleteTier(tier.id)}
                              className="text-xs text-poke-danger hover:underline"
                            >
                              {t('tierEditor.remove')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Add Pokémon form ─────────────────────────────────── */}
        {showAddForm && (
          <Card variant="muted" className="mt-3">
            <form onSubmit={handleAddTier} className="space-y-4">
              <h4 className="text-sm font-heading font-semibold text-poke-text-primary">{t('tierEditor.addTitle')}</h4>

              {/* Search for base form */}
              {!selectedChain ? (
                <div className="relative">
                  <label className="block text-xs font-heading font-semibold text-poke-text-primary mb-1">
                    {t('tierEditor.searchBase')}
                  </label>
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('tierEditor.searchBasePlaceholder', { example: species(SEARCH_EXAMPLE_SPECIES) })}
                    className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-3 py-2 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                  />
                  <p className="text-xs text-poke-text-muted mt-1">
                    {t('tierEditor.threeStageOnly')}
                  </p>

                  {/* Search results dropdown */}
                  {(searchResults.length > 0 || searching) && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-poke-surface border border-poke-border rounded-poke-md shadow-poke-card max-h-60 overflow-y-auto">
                      {searching && (
                        <div className="px-3 py-2 text-sm text-poke-text-muted">{t('tierEditor.searching')}</div>
                      )}
                      {searchResults.map((r) => (
                        <button
                          key={r.name}
                          type="button"
                          onClick={() => selectChain(r)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-poke-elevated transition-colors text-sm"
                        >
                          <PokemonSprite name={r.name} size={28} />
                          <span className="text-poke-text-primary font-medium">{species(r.name)}</span>
                          <span className="text-poke-text-muted text-xs">
                            → {species(r.stage2)} → {species(r.stage3)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Selected chain preview */}
                  <div className="flex items-center gap-2 p-3 bg-poke-elevated rounded-poke-md">
                    <div className="flex items-center gap-1.5">
                      <PokemonSprite name={selectedChain.base} size={32} />
                      <span className="font-medium text-poke-text-primary">{species(selectedChain.base)}</span>
                    </div>
                    <span className="text-poke-text-muted">→</span>
                    <div className="flex items-center gap-1.5">
                      <PokemonSprite name={selectedChain.stage2} size={32} />
                      <span className="text-poke-text-primary">{species(selectedChain.stage2)}</span>
                    </div>
                    <span className="text-poke-text-muted">→</span>
                    <div className="flex items-center gap-1.5">
                      <PokemonSprite name={selectedChain.stage3} size={32} />
                      <span className="text-poke-text-primary">{species(selectedChain.stage3)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedChain(null)}
                      className="ml-auto text-xs text-poke-danger hover:underline"
                    >
                      {t('tierEditor.change')}
                    </button>
                  </div>

                  {/* KO thresholds + tier */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-heading font-semibold text-poke-text-primary mb-1">
                        {t('tierEditor.kosForStage2')}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={stage2Kos}
                        onChange={(e) => setStage2Kos(Number(e.target.value))}
                        required
                        className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1.5 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-heading font-semibold text-poke-text-primary mb-1">
                        {t('tierEditor.kosForStage3')}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={stage3Kos}
                        onChange={(e) => setStage3Kos(Number(e.target.value))}
                        required
                        className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1.5 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-heading font-semibold text-poke-text-primary mb-1">
                        {t('tierEditor.powerTier')}
                      </label>
                      <select
                        value={powerTier}
                        onChange={(e) => setPowerTier(e.target.value as PowerTier)}
                        className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1.5 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                      >
                        {POWER_TIERS.map((pt) => (
                          <option key={pt} value={pt}>{tShared('tier', { tier: pt })}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    loading={submitting}
                  >
                    {t('tierEditor.addToTierList')}
                  </Button>
                </>
              )}
            </form>
          </Card>
        )}
      </div>

      {/* ── Wildcards ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-heading font-semibold text-lg text-poke-text-primary">{t('tierEditor.wildcardTitle')}</h3>
            <p className="text-xs text-poke-text-muted mt-0.5">
              {t('tierEditor.wildcardIntro', { example: species(WILDCARD_EXAMPLE_SPECIES) })}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowWildcardForm(!showWildcardForm)}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {showWildcardForm ? t('tierEditor.cancel') : t('tierEditor.assignWildcardCta')}
          </Button>
        </div>

        {wildcards.length > 0 && (
          <div className="space-y-2">
            {wildcards.map((wc) => {
              const player = participants.find((p) => p.id === wc.player_id);
              return (
                <div
                  key={wc.id}
                  className="flex items-center justify-between p-3 bg-purple-900/20 border border-purple-700/40 rounded-poke-lg text-sm"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant="purple" size="sm">{player?.name ?? t('tierEditor.unknownPlayer')}</Badge>
                    <span className="text-poke-text-muted">&rarr;</span>
                    <span className="inline-flex items-center gap-1.5 text-poke-text-primary">
                      <PokemonSprite name={wc.base_pokemon} size={20} />
                      {species(wc.base_pokemon)}
                    </span>
                    <span className="text-poke-text-muted">&rarr;</span>
                    <span className="inline-flex items-center gap-1.5 text-poke-text-primary">
                      <PokemonSprite name={wc.stage2_pokemon} size={20} />
                      {species(wc.stage2_pokemon)}
                    </span>
                    <span className="text-xs text-poke-text-secondary">{t('tierEditor.kosCount', { count: wc.stage2_kos })}</span>
                    {wc.stage3_pokemon && (
                      <>
                        <span className="text-poke-text-muted">&rarr;</span>
                        <span className="inline-flex items-center gap-1.5 text-poke-text-primary">
                          <PokemonSprite name={wc.stage3_pokemon} size={20} />
                          {species(wc.stage3_pokemon)}
                        </span>
                        <span className="text-xs text-poke-text-secondary">
                          {t('tierEditor.kosCount', { count: wc.stage3_kos ?? 0 })}
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteTier(wc.id)}
                    className="text-xs text-poke-danger hover:underline"
                  >
                    {t('tierEditor.remove')}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {wildcards.length === 0 && !showWildcardForm && (
          <p className="text-sm text-poke-text-muted">{t('tierEditor.noWildcards')}</p>
        )}

        {showWildcardForm && (
          <Card variant="outlined" className="mt-3 border-purple-700/40 bg-purple-900/10">
            <form onSubmit={handleAddWildcard} className="space-y-3">
              <h4 className="text-sm font-heading font-semibold text-poke-text-primary">{t('tierEditor.assignWildcard')}</h4>
              <Select
                label={t('tierEditor.player')}
                value={wildcardPlayerId}
                onChange={(e) => setWildcardPlayerId(e.target.value)}
                required
              >
                <option value="">{t('tierEditor.selectPlayer')}</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>

              {!wildcardChain ? (
                <div className="relative">
                  <label className="block text-xs font-heading font-semibold text-poke-text-primary mb-1">
                    {t('tierEditor.searchPokemon')}
                  </label>
                  <input
                    type="text"
                    value={wildcardSearch}
                    onChange={(e) => setWildcardSearch(e.target.value)}
                    placeholder={t('tierEditor.searchPokemonPlaceholder')}
                    className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-3 py-2 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                  />
                  {(wildcardResults.length > 0 || wildcardSearching) && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-poke-surface border border-poke-border rounded-poke-md shadow-poke-card max-h-48 overflow-y-auto">
                      {wildcardSearching && (
                        <div className="px-3 py-2 text-sm text-poke-text-muted">{t('tierEditor.searching')}</div>
                      )}
                      {wildcardResults.map((r) => (
                        <button
                          key={r.name}
                          type="button"
                          onClick={() => selectWildcardChain(r)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-poke-elevated transition-colors text-sm"
                        >
                          <PokemonSprite name={r.name} size={24} />
                          <span className="text-poke-text-primary">{species(r.name)}</span>
                          <span className="text-poke-text-muted text-xs">
                            → {species(r.stage2)} → {species(r.stage3)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2 bg-poke-elevated rounded-poke-md text-sm">
                  <PokemonSprite name={wildcardChain.base} size={24} />
                  <span className="text-poke-text-primary">{species(wildcardChain.base)}</span>
                  <span className="text-poke-text-muted">
                    → {species(wildcardChain.stage2)} → {species(wildcardChain.stage3)}
                  </span>
                  <button type="button" onClick={() => setWildcardChain(null)} className="ml-auto text-xs text-poke-danger hover:underline">
                    {t('tierEditor.change')}
                  </button>
                </div>
              )}

              {wildcardChain && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-heading font-semibold text-poke-text-primary mb-1">{t('tierEditor.kosForStage2')}</label>
                    <input
                      type="number"
                      min={1}
                      value={wildcardStage2Kos}
                      onChange={(e) => setWildcardStage2Kos(Number(e.target.value))}
                      required
                      className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1.5 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-heading font-semibold text-poke-text-primary mb-1">{t('tierEditor.kosForStage3')}</label>
                    <input
                      type="number"
                      min={1}
                      value={wildcardStage3Kos}
                      onChange={(e) => setWildcardStage3Kos(Number(e.target.value))}
                      required
                      className="w-full border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1.5 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
                    />
                  </div>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={wildcardSubmitting}
                disabled={!wildcardPlayerId || !wildcardChain}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {t('tierEditor.assignWildcard')}
              </Button>
            </form>
          </Card>
        )}
      </div>

      {/* ── Summary ───────────────────────────────────────── */}
      {(tiers.length > 0 || wildcards.length > 0) && (
        <Alert variant="info">
          {t.rich('tierEditor.summaryLines', { count: tiers.length, b: (chunks) => <strong>{chunks}</strong> })}
          {POWER_TIERS.map((pt) => {
            const count = tiersByPower[pt].length;
            if (count === 0) return null;
            return (
              <span key={pt}>
                {' '}
                &middot;{' '}
                {t.rich('tierEditor.summaryTier', { count, tier: pt, b: (chunks) => <strong>{chunks}</strong> })}
              </span>
            );
          })}
          {wildcards.length > 0 && (
            <>
              {' '}
              &middot;{' '}
              {t.rich('tierEditor.summaryWildcards', {
                count: wildcards.length,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </>
          )}
        </Alert>
      )}
    </div>
  );
}
