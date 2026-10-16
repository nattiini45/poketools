import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from '@/i18n/core';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { formatPack } from '@/lib/format-pack';
import { progressSourcesOf, totalEligibleProgress } from '@/lib/draft/progress-sources';
import { breakdown, compareTrackersForDisplay, displayKills, type TrackerLike } from '@/lib/draft-ui/progress-display';
import { progressChipLabels } from '@/lib/draft-ui/progress-labels';
import ProgressSourceChips from '@/components/evolution/ProgressSourceChips';

function tracker(over: Partial<TrackerLike> = {}): TrackerLike {
  return {
    real_kills: 4,
    transferred_evo_progress: 2,
    draft_tokens: 1,
    kill_tokens: 0,
    cosmo_points: 0,
    current_stage: 1,
    total_kos: 7,
    ...over,
  };
}

describe('breakdown', () => {
  it('wraps progressSourcesOf and adds the total', () => {
    const t = tracker();
    expect(breakdown(t)).toEqual({ ...progressSourcesOf(t), totalProgress: totalEligibleProgress(progressSourcesOf(t)) });
    expect(breakdown(t)).toEqual({
      selfEarnedKills: 4,
      transferred: 2,
      draftKillToken: 1,
      comebackToken: 0,
      cosmoToken: 0,
      totalProgress: 7,
    });
  });

  it('treats a missing transferred column (pre-M4) as zero', () => {
    expect(breakdown(tracker({ transferred_evo_progress: null })).transferred).toBe(0);
  });

  it('re-exports displayKills (real_kills only)', () => {
    expect(displayKills(tracker())).toBe(4);
  });
});

describe('compareTrackersForDisplay', () => {
  it('sorts by stage desc, then self-earned KOs desc, then total desc', () => {
    const a = tracker({ current_stage: 2, real_kills: 1, transferred_evo_progress: 0, draft_tokens: 0 });
    const b = tracker({ current_stage: 1, real_kills: 9 });
    const c = tracker({ current_stage: 1, real_kills: 5, transferred_evo_progress: 0, draft_tokens: 0 });
    const d = tracker({ current_stage: 1, real_kills: 5, transferred_evo_progress: 6, draft_tokens: 0 });
    const sorted = [c, b, a, d].sort(compareTrackersForDisplay);
    expect(sorted).toEqual([a, b, d, c]);
  });

  it('never ranks a token-boosted line above more self-earned KOs on the same stage', () => {
    const boosted = tracker({ real_kills: 1, transferred_evo_progress: 0, draft_tokens: 2, kill_tokens: 3, cosmo_points: 4 });
    const earned = tracker({ real_kills: 3, transferred_evo_progress: 0, draft_tokens: 0 });
    expect([boosted, earned].sort(compareTrackersForDisplay)).toEqual([earned, boosted]);
  });
});

describe('ProgressSourceChips', () => {
  const sources = { selfEarnedKills: 4, transferred: 2, draftKillToken: 1, comebackToken: 0, cosmoToken: 3 };

  it('renders KOs plus non-zero sources only (English)', () => {
    const html = renderToStaticMarkup(
      <ProgressSourceChips sources={sources} labels={progressChipLabels(createTranslator(draftSharedMessages, 'en'))} />,
    );
    expect(html).toContain('4 KOs');
    expect(html).toContain('+2 transferred');
    expect(html).toContain('+1 Draft Kill Token');
    expect(html).toContain(formatPack.messages.en.draftShared.progress.cosmoChip.replace('{n}', '3'));
    expect(html).not.toContain('Comeback');
    expect(html).toContain('aria-label="Progress sources"');
  });

  it('renders German labels', () => {
    const html = renderToStaticMarkup(
      <ProgressSourceChips
        compact
        sources={{ ...sources, draftKillToken: 2, comebackToken: 1 }}
        labels={progressChipLabels(createTranslator(draftSharedMessages, 'de'))}
      />,
    );
    expect(html).toContain('4 KOs');
    expect(html).toContain('+2 übertragen');
    expect(html).toContain('+2 Draft-Kill-Tokens');
    expect(html).toContain('+1 Comeback');
    expect(html).toContain('aria-label="Fortschrittsquellen"');
  });

  it('shows only the KO count when nothing else contributes', () => {
    const html = renderToStaticMarkup(
      <ProgressSourceChips
        sources={{ selfEarnedKills: 1, transferred: 0, draftKillToken: 0, comebackToken: 0, cosmoToken: 0 }}
        labels={progressChipLabels(createTranslator(draftSharedMessages, 'en'))}
      />,
    );
    expect(html).toContain('1 KO<');
    expect(html).not.toContain('data-source');
  });
});
