'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TierBadge from '@/components/shared/TierBadge';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import { useDataLocale, useT } from '@/i18n/client';
import { commonMessages } from '@/i18n/messages/common';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { localizeLineLabel, localizeSpecies, speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { rankedSearch } from '@/lib/pkmn/i18n/search';
import type { DraftType } from '@/types/draft';
import type { DraftPoolEntry } from '@/types/draft-pool';
import type { EvolutionTier, DraftTierLimit, PowerTier } from '@/types/evolution';
import { getLineIdentity } from '@/lib/draft/line-identity';
import {
  auctionReserve,
  bidProblems,
  isPickBlocked,
  lineSearchKeys,
  listedPickPrice,
  pickPointsToSend,
  pointsOnRowSelect,
  remainingAfterPick,
  reserveOverBudget,
  rowPointCost,
  type BidProblem,
} from './pick-selector-model';

interface PickSelectorProps {
  takenPokemon: Set<string>;
  draftType: DraftType;
  /** Remaining budget for auction/budget drafts */
  remainingBudget: number | null;
  /** The pool's `default_point_cost`: the price of a `budget` pick whose entry has no cost. */
  defaultPointCost?: number | null;
  /** Makes the pick; the confirm dialog shows a spinner until a returned promise settles. */
  onPick: (pokemonName: string, pointsSpent?: number, stage3Pokemon?: string | null) => void | Promise<void>;
  onClose: () => void;
  /** Universal draft pool entries — restricts picks to these Pokémon */
  poolEntries?: DraftPoolEntry[];
  /** If provided, restricts picks to only these Pokémon (evo-league mode) */
  evoTiers?: EvolutionTier[];
  /** Per-tier draft limits */
  tierLimits?: DraftTierLimit[];
  /** Current player's roster (for tier limit checking) */
  playerRoster?: string[];
  /** EPB mode: show prices and use line identity keys */
  isEpb?: boolean;
  /** Already translated error of the last pick attempt, shown in the footer. */
  error?: string | null;
}

interface PokemonSearchResult {
  name: string;
  types: string[];
  tier?: string;
  stage3?: string | null;
  pointCost?: number;
  lineKey?: string;
}

export default function PickSelector({
  takenPokemon,
  draftType,
  remainingBudget,
  defaultPointCost = null,
  onPick,
  onClose,
  poolEntries,
  evoTiers,
  tierLimits,
  playerRoster,
  isEpb = false,
  error = null,
}: PickSelectorProps) {
  const t = useT(draftLegacyBoardMessages);
  const tLegacy = useT(draftLegacyMessages);
  const tCommon = useT(commonMessages);
  const tGlossary = useT(glossaryMessages);
  const dataLocale = useDataLocale();
  const [query, setQuery] = useState('');
  const [apiResults, setApiResults] = useState<PokemonSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedStage3, setSelectedStage3] = useState<string | null>(null);
  const [pointsSpent, setPointsSpent] = useState<number>(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasPool = Boolean(poolEntries && poolEntries.length > 0);
  const isEvoLeague = Boolean(evoTiers && evoTiers.length > 0);

  // Build lookup maps for pool entries (EPB uses line identity keys)
  const poolLookup = useMemo(() => {
    if (!poolEntries) return new Map<string, DraftPoolEntry>();
    const map = new Map<string, DraftPoolEntry>();
    for (const entry of poolEntries) {
      const key = isEpb
        ? getLineIdentity(entry.pokemon_name, entry.stage3_pokemon ?? null)
        : entry.pokemon_name.toLowerCase();
      map.set(key, entry);
    }
    return map;
  }, [poolEntries, isEpb]);

  // Build lookup maps for evo-league mode
  const tierLookup = useMemo(() => {
    if (!evoTiers) return new Map<string, EvolutionTier>();
    const map = new Map<string, EvolutionTier>();
    for (const tier of evoTiers) {
      map.set(tier.base_pokemon.toLowerCase(), tier);
    }
    return map;
  }, [evoTiers]);

  const tierLimitMap = useMemo(() => {
    if (!tierLimits) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const limit of tierLimits) {
      if (limit.max_picks > 0) map.set(limit.power_tier, limit.max_picks);
    }
    return map;
  }, [tierLimits]);

  // Count how many of each tier the player already has (works for both pool entries and evo tiers)
  const playerTierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!playerRoster) return counts;
    for (const pokemonName of playerRoster) {
      // Prefer pool entry tier, fall back to evo tier
      const poolEntry = poolLookup.get(pokemonName.toLowerCase());
      const powerTier = poolEntry?.power_tier ?? tierLookup.get(pokemonName.toLowerCase())?.power_tier;
      if (powerTier) {
        counts[powerTier] = (counts[powerTier] || 0) + 1;
      }
    }
    return counts;
  }, [playerRoster, poolLookup, tierLookup]);

  function isTierFull(powerTier: PowerTier): boolean {
    const limit = tierLimitMap.get(powerTier);
    if (!limit) return false; // unlimited
    return (playerTierCounts[powerTier] || 0) >= limit;
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Pool and evo-league modes filter locally; the query matches English and German names.
  const localResults = useMemo((): PokemonSearchResult[] | null => {
    if (hasPool && !isEvoLeague && poolEntries) {
      return rankedSearch(poolEntries, query, (e) => lineSearchKeys(e.pokemon_name, e.stage3_pokemon ?? null)).map(
        (e) => ({
          name: e.pokemon_name,
          types: [] as string[],
          tier: e.power_tier ?? undefined,
          stage3: e.stage3_pokemon ?? null,
          pointCost: e.point_cost ?? undefined,
          lineKey: getLineIdentity(e.pokemon_name, e.stage3_pokemon ?? null),
        }),
      );
    }
    if (isEvoLeague && evoTiers) {
      return rankedSearch(evoTiers, query, (tier) => speciesSearchKeys(tier.base_pokemon)).map((tier) => ({
        name: tier.base_pokemon,
        types: [],
        tier: tier.power_tier,
      }));
    }
    return null;
  }, [hasPool, isEvoLeague, poolEntries, evoTiers, query]);

  const apiMode = localResults === null;

  useEffect(() => {
    // Unrestricted mode: search via API (no pool entries)
    if (!apiMode || query.length < 2) return;

    const controller = new AbortController();
    const debounce = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/pkmn/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        const json = await res.json();
        if (json.success) {
          setApiResults(json.data);
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
  }, [query, apiMode]);

  const results: PokemonSearchResult[] = localResults ?? (query.length >= 2 ? apiResults : []);

  const selectedEntry = selected
    ? poolLookup.get(
        isEpb
          ? getLineIdentity(selected, selectedStage3)
          : selected.toLowerCase(),
      )
    : undefined;
  // EPB lines and `budget` pool picks have a listed price the server charges; auction picks are typed bids.
  const selectedListedPrice = selected
    ? listedPickPrice(draftType, isEpb, selectedEntry?.point_cost, defaultPointCost)
    : null;
  // An auction bid must be a whole number from the entry's reserve up to the remaining budget (the server refuses others).
  const selectedReserve = selected ? auctionReserve(draftType, isEpb, selectedEntry?.point_cost) : null;
  const selectedPointCost = isEpb ? (selectedEntry?.point_cost ?? undefined) : (selectedListedPrice ?? pointsSpent);
  // One decision for the confirm button, the armed dialog and handleConfirm.
  const pickBlocked = isPickBlocked({
    hasSelection: selected !== null,
    listedPrice: selectedListedPrice,
    reserve: selectedReserve,
    remainingBudget,
    typedPoints: pointsSpent,
  });
  // What the picker has left once this pick is made (draft-backend §13.2).
  const budgetAfterPick = remainingAfterPick(remainingBudget, selectedPointCost);

  const selectedLabel = selected
    ? isEpb
      ? localizeLineLabel(selected, selectedStage3, dataLocale)
      : localizeSpecies(selected, dataLocale)
    : '';

  async function handleConfirm() {
    if (!selected || pickBlocked) return;
    setSubmitting(true);
    try {
      if (isEpb) {
        await onPick(selected, selectedPointCost ?? undefined, selectedStage3);
      } else {
        await onPick(
          selected,
          pickPointsToSend({
            draftType,
            isEpb,
            pointCost: selectedEntry?.point_cost,
            defaultPointCost,
            typedPoints: pointsSpent,
          }),
        );
      }
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  const costSummary =
    selected && (isEpb || selectedListedPrice !== null)
      ? budgetAfterPick !== null
        ? t.rich('picker.costWithRemaining', {
            cost: selectedPointCost ?? '—',
            remaining: budgetAfterPick,
            b: (chunks) => <strong>{chunks}</strong>,
          })
        : t.rich('picker.cost', { cost: selectedPointCost ?? '—', b: (chunks) => <strong>{chunks}</strong> })
      : null;

  return (
    <Modal open={true} onClose={onClose} title={t('picker.title')} size="lg">
      {/* Search */}
      <div className="mb-3">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={hasPool || isEvoLeague ? t('picker.filterPool') : t('picker.searchPokemon')}
          className="w-full px-3 py-2 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 transition-colors"
        />
        {(hasPool || isEvoLeague) && (
          <p className="text-xs text-poke-text-muted mt-1">
            {t('picker.poolOnly')}
          </p>
        )}
      </div>

      {/* Results */}
      <div className="max-h-[50vh] overflow-y-auto -mx-6 px-6">
        {searching && (
          <div className="p-4 text-center text-poke-text-muted text-sm">{t('picker.searching')}</div>
        )}
        {!searching && results.length === 0 && query.length >= (isEvoLeague ? 1 : 2) && (
          <div className="p-4 text-center text-poke-text-muted text-sm">{tCommon('states.noResults')}</div>
        )}
        {results.map((mon) => {
          const lineKey = mon.lineKey ?? mon.name;
          const isTaken = isEpb
            ? takenPokemon.has(lineKey)
            : takenPokemon.has(mon.name);
          const isSelected = selected === mon.name && (isEpb ? selectedStage3 === (mon.stage3 ?? null) : true);
          const powerTier = mon.tier as PowerTier | undefined;
          const tierFull = powerTier ? isTierFull(powerTier) : false;
          // Priced from the same pool entry the selected-line checks read (evo rows carry no cost of their own).
          const rowEntry = poolLookup.get(
            isEpb ? getLineIdentity(mon.name, mon.stage3 ?? null) : mon.name.toLowerCase(),
          );
          const rowCost = rowPointCost(rowEntry?.point_cost, mon.pointCost);
          const rowPrice = listedPickPrice(draftType, isEpb, rowCost, defaultPointCost);
          const rowReserve = auctionReserve(draftType, isEpb, rowCost);
          // A listed price above the budget, or an auction reserve above it (no valid bid exists).
          const overBudget =
            (rowPrice !== null && remainingBudget != null && rowPrice > remainingBudget) ||
            reserveOverBudget(rowReserve, remainingBudget);
          const isDisabled = isTaken || tierFull || overBudget;
          const evoTier = isEvoLeague ? tierLookup.get(mon.name.toLowerCase()) : undefined;

          return (
            <button
              key={lineKey}
              disabled={isDisabled}
              onClick={() => {
                setSelected(mon.name);
                setSelectedStage3(mon.stage3 ?? null);
                // A newly selected auction line starts its bid at the reserve; re-clicking keeps the typed bid.
                setPointsSpent(
                  pointsOnRowSelect({
                    alreadySelected: isSelected,
                    currentPoints: pointsSpent,
                    isEpb,
                    pointCost: rowCost,
                    reserve: rowReserve,
                  }),
                );
              }}
              className={`w-full flex items-center gap-3 p-2 rounded-poke-md text-left transition-colors ${
                isDisabled
                  ? 'opacity-40 cursor-not-allowed'
                  : isSelected
                  ? 'bg-poke-blue-light border border-poke-border-focus'
                  : 'hover:bg-poke-elevated'
              }`}
            >
              <PokemonSprite name={mon.name} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-poke-text-primary">
                  {isEpb
                    ? localizeLineLabel(mon.name, mon.stage3 ?? null, dataLocale)
                    : localizeSpecies(mon.name, dataLocale)}
                </div>
                <div className="text-xs text-poke-text-muted">
                  {mon.types.length > 0 ? mon.types.map((type) => localizeType(type, dataLocale)).join(' / ') : ''}
                  {rowPrice !== null && (
                    <span>{mon.types.length > 0 ? ' · ' : ''}{tLegacy('pts', { n: rowPrice })}</span>
                  )}
                  {/* A reserve above the floor of 1 shows before the line is picked. */}
                  {rowReserve !== null && rowReserve > 1 && (
                    <span>{mon.types.length > 0 ? ' · ' : ''}{t('picker.minBid', { n: rowReserve })}</span>
                  )}
                  {evoTier && (
                    <>
                      {mon.types.length > 0 && ' · '}
                      {localizeSpecies(evoTier.stage2_pokemon, dataLocale)}
                      {evoTier.stage3_pokemon ? ` → ${localizeSpecies(evoTier.stage3_pokemon, dataLocale)}` : null}
                    </>
                  )}
                </div>
              </div>
              {/* Tier badge */}
              {powerTier && (
                <TierBadge tier={powerTier} />
              )}
              {isTaken && (
                <Badge variant="red" size="sm">{t('picker.drafted')}</Badge>
              )}
              {!isTaken && tierFull && (
                <Badge variant="yellow" size="sm">{t('picker.tierFull')}</Badge>
              )}
              {!isTaken && !tierFull && overBudget && (
                <Badge variant="red" size="sm">{t('picker.overBudget')}</Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer: confirm + budget input */}
      <div className="pt-4 border-t border-poke-border mt-4 space-y-3">
        {selectedReserve !== null && (
          <AuctionBidField
            value={pointsSpent}
            reserve={selectedReserve}
            remainingBudget={remainingBudget}
            onChange={setPointsSpent}
          />
        )}
        {costSummary && (
          <p className="text-sm text-poke-text-secondary" data-testid="pick-cost-summary">
            {costSummary}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-poke-danger-ink">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={pickBlocked}
          >
            {t('picker.confirmPick')}
          </Button>
        </div>
      </div>

      {/* The pick itself: Cancel has focus and Draft stays disabled for CONFIRM_ARM_MS (draft-backend §13.2). */}
      <ArmedConfirmDialog
        open={confirmOpen && !pickBlocked}
        title={t('picker.confirmTitle', { name: selectedLabel })}
        body={
          <div className="space-y-1">
            {costSummary && <p>{costSummary}</p>}
            <p>{t('picker.confirmBody')}</p>
          </div>
        }
        confirmLabel={tGlossary('draft.draftCta')}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmOpen(false)}
        submitting={submitting}
      />
    </Modal>
  );
}

/**
 * The bid input of an auction pick: its `min` is the line's reserve, which is also
 * shown as a hint, so an under-reserve bid is visible before the pick is armed.
 * A non-whole bid and a bid above the remaining budget are marked invalid with
 * their own messages; a polite live region announces every reason that applies
 * (`bidProblems`). `max` is only set when the budget reaches the reserve, so min
 * and max never contradict.
 */
export function AuctionBidField({
  value,
  reserve,
  remainingBudget,
  onChange,
}: {
  value: number;
  reserve: number;
  remainingBudget: number | null;
  onChange: (points: number) => void;
}) {
  const t = useT(draftLegacyBoardMessages);
  const problems = bidProblems(reserve, remainingBudget, value);
  const notWhole = problems.includes('notWhole');
  const below = problems.includes('belowReserve');
  const over = problems.includes('overBudget') && remainingBudget !== null;
  const max = remainingBudget !== null && remainingBudget >= reserve ? remainingBudget : undefined;
  const problemText = (problem: BidProblem): string => {
    switch (problem) {
      case 'notWhole':
        return t('picker.bidNotWhole');
      case 'belowReserve':
        return t('picker.bidBelowReserve', { n: reserve });
      case 'overBudget':
        return t('picker.bidOverBudget', { n: remainingBudget ?? 0 });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="pick-bid" className="text-sm text-poke-text-muted">{t('picker.pointsLabel')}</label>
      <input
        id="pick-bid"
        type="number"
        min={reserve}
        step={1}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-invalid={problems.length > 0 || undefined}
        aria-describedby={problems.length > 0 ? 'pick-bid-min pick-bid-status' : 'pick-bid-min'}
        className="w-20 px-2 py-1 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 transition-colors"
      />
      <span
        id="pick-bid-min"
        data-testid="pick-bid-min"
        className={`text-xs ${below ? 'text-poke-danger-ink' : 'text-poke-text-muted'}`}
      >
        {t('picker.minBid', { n: reserve })}
      </span>
      {remainingBudget !== null && (
        <span className="text-xs text-poke-text-muted">
          {t('picker.remaining', { n: remainingBudget })}
        </span>
      )}
      {/* Shown for sighted users (below the reserve shows as the red hint); screen readers hear the live region. */}
      {notWhole && (
        <span data-testid="pick-bid-not-whole" aria-hidden="true" className="text-xs text-poke-danger-ink">
          {problemText('notWhole')}
        </span>
      )}
      {over && (
        <span id="pick-bid-over" data-testid="pick-bid-over" aria-hidden="true" className="text-xs text-poke-danger-ink">
          {problemText('overBudget')}
        </span>
      )}
      {/* Always rendered so changes are announced; sr-only (absolutely positioned) keeps the row layout unchanged. */}
      <span id="pick-bid-status" data-testid="pick-bid-status" role="status" aria-live="polite" className="sr-only">
        {problems.map(problemText).join(' ')}
      </span>
    </div>
  );
}
