import { describe, expect, it } from 'vitest';
import { resolveEpbStage, type LineThresholds } from '@/lib/match/epb-stage-resolution';
import {
  PROGRESS_SOURCE_ORDER,
  displayKills,
  progressSourcesOf,
  totalEligibleProgress,
} from '../progress-sources';

const tracker = (over: Partial<Parameters<typeof progressSourcesOf>[0]> = {}) => ({
  real_kills: 0,
  transferred_evo_progress: 0,
  draft_tokens: 0,
  kill_tokens: 0,
  cosmo_points: 0,
  ...over,
});

/** `dreepy--dragapult` of the EPB list v1 fixture: 2 to stage 2, +13 to stage 3 (cumulative 15). */
const DREEPY: LineThresholds = {
  base_pokemon: 'Dreepy',
  stage2_pokemon: 'Drakloak',
  stage3_pokemon: 'Dragapult',
  stage2_kos: 2,
  stage3_kos: 15,
};

describe('progressSourcesOf', () => {
  it('maps the DB columns to the five spec sources', () => {
    expect(
      progressSourcesOf(tracker({ real_kills: 5, transferred_evo_progress: 3, draft_tokens: 1, kill_tokens: 2, cosmo_points: 4 })),
    ).toEqual({ selfEarnedKills: 5, transferred: 3, draftKillToken: 1, comebackToken: 2, cosmoToken: 4 });
  });

  it('treats a missing or null transferred column (before M4) as 0', () => {
    expect(progressSourcesOf(tracker({ transferred_evo_progress: null })).transferred).toBe(0);
    const { transferred_evo_progress: _omit, ...legacy } = tracker({ real_kills: 2 });
    void _omit;
    expect(progressSourcesOf(legacy).transferred).toBe(0);
  });

  it('lists the sources in display order', () => {
    expect(PROGRESS_SOURCE_ORDER).toEqual(['selfEarnedKills', 'transferred', 'draftKillToken', 'comebackToken', 'cosmoToken']);
  });
});

describe('totalEligibleProgress / displayKills', () => {
  it('sums all five sources (= tracker.total_kos)', () => {
    const s = progressSourcesOf(tracker({ real_kills: 5, transferred_evo_progress: 3, draft_tokens: 1, kill_tokens: 2, cosmo_points: 4 }));
    expect(totalEligibleProgress(s)).toBe(15);
  });

  it('labels only real kills as kills', () => {
    const t = tracker({ real_kills: 5, transferred_evo_progress: 9, draft_tokens: 2, kill_tokens: 2, cosmo_points: 1 });
    expect(displayKills(t)).toBe(5);
  });

  it('redraft example: Dratini with 9 real kills → Dreepy starts at 0 self-earned, 9 transferred', () => {
    const dreepy = tracker({ transferred_evo_progress: 9 });
    const s = progressSourcesOf(dreepy);
    expect(s.selfEarnedKills).toBe(0);
    expect(displayKills(dreepy)).toBe(0); // public kill ranking
    expect(s.transferred).toBe(9);
    expect(totalEligibleProgress(s)).toBe(9); // counts for evolution
    expect(resolveEpbStage(DREEPY, totalEligibleProgress(s)).stage).toBe(2);
  });

  it('cocoon example: 1 real kill transfers 1; Dreepy does not inherit stage 3', () => {
    // An instant-final-stage line reached stage 3 with 1 real kill; only the real kill transfers.
    const instantLine = tracker({ real_kills: 1 });
    const transferred = displayKills(instantLine);
    expect(transferred).toBe(1);
    const dreepy = tracker({ transferred_evo_progress: transferred });
    const total = totalEligibleProgress(progressSourcesOf(dreepy));
    expect(resolveEpbStage(DREEPY, total)).toEqual({ form: 'Dreepy', stage: 1 });
  });
});
