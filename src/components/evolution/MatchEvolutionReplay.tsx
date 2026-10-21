'use client';

import { useState, useCallback } from 'react';
import CrystalXPBar from '@/components/evolution/CrystalXPBar';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import type { Translator } from '@/i18n/core';
import { draftLegacyEvolutionMessages, type DraftLegacyEvolutionEn } from '@/i18n/messages/draft/legacy/evolution';
import { draftSharedMessages, type DraftSharedEn } from '@/i18n/messages/draft/shared';
import { epbLineRuleForBase } from '@/lib/format-pack';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { MatchEvolutionSnapshot } from '@/types/evolution';

function isInstantFinalStageBase(base: string | null | undefined): boolean {
  return !!base && !!epbLineRuleForBase(base)?.instantFinalStage;
}

interface ReplayStep {
  snapshot: MatchEvolutionSnapshot;
  max: number;
  evolvedInto: string | null;
  overflowAfter: number;
  nextMax: number | null;
  isCompact: boolean;
}

interface MatchEvolutionReplayProps {
  matchId: string;
  /** Whether the current viewer already viewed this replay (from server) */
  initialViewed: boolean;
  /** Whether the viewer is logged in (controls auto-play) */
  isAuthenticated: boolean;
  /** Snapshots where evolution_triggered = true */
  evolutionSnapshots: MatchEvolutionSnapshot[];
  targets: Record<string, number>;
  evolvedInto: Record<string, string>;
  /** Next-stage thresholds keyed by snapshot id (for overflow bar reset) */
  nextStageTargets?: Record<string, number>;
}

/**
 * Crystal XP animation replay for Evolution League matches.
 * Viewed state persisted server-side per player (not localStorage).
 */
export default function MatchEvolutionReplay({
  matchId,
  initialViewed,
  isAuthenticated,
  evolutionSnapshots,
  targets,
  evolvedInto,
  nextStageTargets = {},
}: MatchEvolutionReplayProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const tShared = useT(draftSharedMessages);
  const dataLocale = useDataLocale();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewed, setViewed] = useState(initialViewed);
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? (isAuthenticated && !viewed);

  const steps: ReplayStep[] = evolutionSnapshots.map((snapshot, i) => {
    const max = targets[snapshot.id] ?? snapshot.progress_after;
    const next = evolutionSnapshots[i + 1];
    const overflowAfter = next && next.tracker_id === snapshot.tracker_id
      ? next.progress_before
      : Math.max(0, snapshot.progress_after - max);
    const nextMax = nextStageTargets[snapshot.id] ?? (next ? (targets[next.id] ?? null) : null);
    // An instant-final-stage line (format pack `lineRules[].instantFinalStage`) evolves twice at once.
    const isInstantFinalChain =
      isInstantFinalStageBase(snapshot.base_pokemon) ||
      (i > 0 && isInstantFinalStageBase(evolutionSnapshots[i - 1]?.base_pokemon));
    return {
      snapshot,
      max,
      evolvedInto: evolvedInto[snapshot.id] ?? null,
      overflowAfter,
      nextMax,
      isCompact: i > 0 && isInstantFinalChain,
    };
  });

  const markViewed = useCallback(async () => {
    if (!isAuthenticated || viewed) return;
    // The replay counts as viewed for this session either way; a failed write is logged (the server keeps
    // offering the replay expanded on the next visit), never hidden.
    try {
      const res = await fetch(`/api/matches/${matchId}/epb-replay-viewed`, { method: 'POST' });
      if (!res.ok) console.error(`[MatchEvolutionReplay] marking match ${matchId} viewed failed: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[MatchEvolutionReplay] marking match ${matchId} viewed failed`, err);
    }
    setViewed(true);
  }, [isAuthenticated, viewed, matchId]);

  if (evolutionSnapshots.length === 0) return null;

  const handleAnimationComplete = () => {
    if (currentIndex < steps.length - 1) {
      setTimeout(() => setCurrentIndex((i) => i + 1), steps[currentIndex].isCompact ? 200 : 400);
    } else {
      void markViewed();
    }
  };

  const handleSkip = () => {
    setCurrentIndex(steps.length - 1);
    void markViewed();
    setOverride(false);
  };

  if (!expanded) {
    return (
      <div className="rounded-lg border border-cyan-800/40 bg-cyan-950/20 p-3">
        <button
          type="button"
          onClick={() => { setOverride(true); setCurrentIndex(0); }}
          className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          <span className="inline-block h-3 w-3 rotate-45 rounded-[2px] bg-cyan-400" />
          {t('replay.play', { count: evolutionSnapshots.length })}
        </button>
      </div>
    );
  }

  const step = steps[currentIndex];
  const { snapshot } = step;
  const progressSource = buildProgressSource(snapshot, t, tShared);
  const speciesLabel = localizeSpecies(snapshot.species_at_match, dataLocale);
  const evolvedLabel = step.evolvedInto ? localizeSpecies(step.evolvedInto, dataLocale) : null;

  return (
    <div className="rounded-lg border border-cyan-800/40 bg-cyan-950/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-heading font-semibold text-cyan-300">
          {t('replay.title')}
        </h4>
        <div className="flex items-center gap-2">
          <span className="text-xs text-poke-text-muted">
            {currentIndex + 1}/{steps.length}
          </span>
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs text-poke-text-secondary underline hover:text-poke-text"
          >
            {t('replay.skipAll')}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <CrystalXPBar
          key={snapshot.id}
          current={Math.min(snapshot.progress_after, step.max)}
          max={step.max}
          label={speciesLabel}
          previousValue={snapshot.progress_before}
          isEvolution={snapshot.evolution_triggered}
          isCompact={step.isCompact}
          progressSource={progressSource}
          overflowAfter={step.overflowAfter}
          nextMax={step.nextMax ?? undefined}
          spriteSpecies={snapshot.species_at_match}
          nextSpriteSpecies={step.evolvedInto ?? undefined}
          nextLabel={evolvedLabel ?? undefined}
          onAnimationComplete={handleAnimationComplete}
        />

        <div className="flex items-center gap-2 rounded bg-poke-elevated p-2">
          <PokemonSprite name={snapshot.species_at_match} size={32} />
          <span className="text-poke-text-muted">→</span>
          {step.evolvedInto && <PokemonSprite name={step.evolvedInto} size={32} />}
          <span className="text-sm font-medium text-poke-text-primary">
            {speciesLabel}
            {evolvedLabel ? ` → ${evolvedLabel}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The "+N" sources of this match's progress, with the spec's token names (§8.3). */
function buildProgressSource(
  snapshot: MatchEvolutionSnapshot,
  t: Translator<DraftLegacyEvolutionEn>,
  tShared: Translator<DraftSharedEn>,
): string | undefined {
  const parts: string[] = [];
  if (snapshot.real_kos > 0) parts.push(t('replay.kosGained', { count: snapshot.real_kos }));
  if (snapshot.draft_tokens_delta > 0) {
    parts.push(tShared('progress.draftKillChip', { count: snapshot.draft_tokens_delta }));
  }
  if (snapshot.kill_tokens_delta > 0) parts.push(tShared('progress.comebackChip', { n: snapshot.kill_tokens_delta }));
  if (snapshot.cosmo_points_delta > 0) parts.push(tShared('progress.cosmoChip', { n: snapshot.cosmo_points_delta }));
  return parts.length > 0 ? parts.join(', ') : undefined;
}
