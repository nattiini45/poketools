import { describe, it, expect } from 'vitest';
import { EPB_DEFAULT_RULES } from '../format-rules-defaults';
import { getFormatCapabilities } from '../format-capabilities';
import { epbPack } from '@/lib/format-pack';

// The league's values live in the format pack; the moved copy in the private pack pins them.
const P = epbPack;

describe('EPB_DEFAULT_RULES', () => {
  it('takes the point budget and picks from the format pack', () => {
    expect(EPB_DEFAULT_RULES.draft_budget).toBe(P.defaults.draftBudget);
    expect(EPB_DEFAULT_RULES.draft_picks).toBe(P.defaults.draftPicks);
  });

  it('takes the token settings from the format pack', () => {
    expect(EPB_DEFAULT_RULES.draft_token_ratio).toBe(P.defaults.tokenRatio);
    expect(EPB_DEFAULT_RULES.draft_token_max).toBe(P.defaults.tokenMax);
    expect(EPB_DEFAULT_RULES.draft_token_max_per_line).toBe(P.defaults.tokenMaxPerLine);
  });

  it('has stage-based tera rules from the format pack', () => {
    expect(EPB_DEFAULT_RULES.tera_rules).toEqual({ ...P.teraByStage });
  });

  it('bans the format pack default moves and items', () => {
    expect(EPB_DEFAULT_RULES.banned_moves).toEqual([...P.defaults.bannedMoves]);
    expect(EPB_DEFAULT_RULES.banned_items).toEqual([...P.defaults.bannedItems]);
  });

  it('uses the format pack tiebreaker chain', () => {
    expect(EPB_DEFAULT_RULES.tiebreaker_order).toEqual([...P.tiebreakerChain]);
  });

  it('is a mutable copy (the pack itself is frozen)', () => {
    expect(Object.isFrozen(EPB_DEFAULT_RULES.banned_moves)).toBe(false);
    expect(Object.isFrozen(EPB_DEFAULT_RULES.tiebreaker_order)).toBe(false);
  });

  it('matches the example pack values', () => {
    // The public suite runs on the example pack (vitest `app` project).
    expect(EPB_DEFAULT_RULES).toMatchObject({
      draft_budget: 100,
      draft_picks: 6,
      draft_token_ratio: 5,
      draft_token_max: 1,
      draft_token_max_per_line: 1,
      tera_rules: { stage1: 'any', stage2: 'any', stage3: 'stab_only' },
      banned_moves: ['Last Respects'],
      banned_items: ['Bright Powder'],
    });
  });
});

describe('EPB admin section gating via capabilities', () => {
  const caps = getFormatCapabilities('evolution_point_buy');

  it('hides participant type assignment', () => {
    expect(caps.participantTypeAssignment).toBe(false);
  });

  it('hides Type Cores', () => {
    expect(caps.typeCores).toBe(false);
  });

  it('hides Evolution Tiers (old system)', () => {
    expect(caps.evolutionTiers).toBe(false);
  });

  it('hides Wildcards', () => {
    expect(caps.wildcards).toBe(false);
  });

  it('hides tier limits (A/B/C/D)', () => {
    expect(caps.tierLimits).toBe(false);
  });

  it('hides generic draft pool', () => {
    expect(caps.genericDraftPool).toBe(false);
  });

  it('shows point-buy list', () => {
    expect(caps.pointBuyList).toBe(true);
  });

  it('shows draft tokens', () => {
    expect(caps.draftTokens).toBe(true);
  });

  it('shows kill tokens', () => {
    expect(caps.killTokens).toBe(true);
  });

  it('shows cosmo points', () => {
    expect(caps.cosmoPoints).toBe(true);
  });

  it('shows evolution progress', () => {
    expect(caps.evolutionProgress).toBe(true);
  });

  it('shows matchup roles', () => {
    expect(caps.matchupRoles).toBe(true);
  });
});

describe('Draft format keeps legacy features', () => {
  const caps = getFormatCapabilities('draft');

  it('keeps Evolution Tiers', () => {
    expect(caps.evolutionTiers).toBe(true);
  });

  it('keeps Wildcards', () => {
    expect(caps.wildcards).toBe(true);
  });

  it('keeps tier limits', () => {
    expect(caps.tierLimits).toBe(true);
  });

  it('keeps generic draft pool', () => {
    expect(caps.genericDraftPool).toBe(true);
  });

  it('does not show point-buy list', () => {
    expect(caps.pointBuyList).toBe(false);
  });
});
