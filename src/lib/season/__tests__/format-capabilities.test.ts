import { describe, it, expect } from 'vitest';
import { getFormatCapabilities } from '../format-capabilities';
import type { SeasonFormatType } from '@/types/season';

describe('getFormatCapabilities', () => {
  it('returns all EPB flags true for evolution_point_buy', () => {
    const caps = getFormatCapabilities('evolution_point_buy');

    // EPB-specific capabilities must be enabled
    expect(caps.pointBuyList).toBe(true);
    expect(caps.draftTokens).toBe(true);
    expect(caps.killTokens).toBe(true);
    expect(caps.cosmoPoints).toBe(true);
    expect(caps.evolutionProgress).toBe(true);
    expect(caps.evolutionPoints).toBe(true);
    expect(caps.evolutionRedraft).toBe(true);
    expect(caps.earlyFinalStageLock).toBe(true);
    expect(caps.matchupRoles).toBe(true);

    // Legacy draft/gym/core features must be disabled
    expect(caps.participantTypeAssignment).toBe(false);
    expect(caps.typeCores).toBe(false);
    expect(caps.evolutionTiers).toBe(false);
    expect(caps.wildcards).toBe(false);
    expect(caps.tierLimits).toBe(false);
    expect(caps.genericDraftPool).toBe(false);
  });

  it('returns draft-specific flags for draft format', () => {
    const caps = getFormatCapabilities('draft');

    // Draft capabilities
    expect(caps.evolutionTiers).toBe(true);
    expect(caps.wildcards).toBe(true);
    expect(caps.tierLimits).toBe(true);
    expect(caps.genericDraftPool).toBe(true);

    // Classic-format participant features stay available
    expect(caps.participantTypeAssignment).toBe(true);
    expect(caps.typeCores).toBe(true);

    // EPB capabilities must be disabled
    expect(caps.pointBuyList).toBe(false);
    expect(caps.draftTokens).toBe(false);
    expect(caps.killTokens).toBe(false);
    expect(caps.cosmoPoints).toBe(false);
    expect(caps.evolutionProgress).toBe(false);
    expect(caps.evolutionPoints).toBe(false);
    expect(caps.evolutionRedraft).toBe(false);
    expect(caps.earlyFinalStageLock).toBe(false);
    expect(caps.matchupRoles).toBe(false);
  });

  for (const format of ['singles', 'doubles'] as const) {
    it(`keeps classic participant features and disables everything else for ${format}`, () => {
      const caps = getFormatCapabilities(format);

      // Gym-type assignment + Core Liga run on classic formats
      expect(caps.participantTypeAssignment).toBe(true);
      expect(caps.typeCores).toBe(true);

      // All draft/EPB capabilities disabled
      expect(caps.evolutionTiers).toBe(false);
      expect(caps.wildcards).toBe(false);
      expect(caps.tierLimits).toBe(false);
      expect(caps.genericDraftPool).toBe(false);
      expect(caps.pointBuyList).toBe(false);
      expect(caps.draftTokens).toBe(false);
      expect(caps.killTokens).toBe(false);
      expect(caps.cosmoPoints).toBe(false);
      expect(caps.evolutionProgress).toBe(false);
      expect(caps.evolutionPoints).toBe(false);
      expect(caps.evolutionRedraft).toBe(false);
      expect(caps.earlyFinalStageLock).toBe(false);
      expect(caps.matchupRoles).toBe(false);
    });
  }

  it('covers all known format types', () => {
    const formats: SeasonFormatType[] = ['singles', 'doubles', 'draft', 'evolution_point_buy'];
    for (const format of formats) {
      const caps = getFormatCapabilities(format);
      expect(caps).toBeDefined();
      expect(typeof caps.pointBuyList).toBe('boolean');
    }
  });

  it('returns frozen capability objects (callers must not mutate)', () => {
    const formats: SeasonFormatType[] = ['singles', 'doubles', 'draft', 'evolution_point_buy'];
    for (const format of formats) {
      expect(Object.isFrozen(getFormatCapabilities(format))).toBe(true);
    }
  });
});

/** Every flag of every classic format, pinned in full so a new format or flag cannot shift one by accident. */
const ALL_OFF = {
  participantTypeAssignment: false,
  typeCores: false,
  evolutionTiers: false,
  wildcards: false,
  tierLimits: false,
  genericDraftPool: false,
  pointBuyList: false,
  draftTokens: false,
  killTokens: false,
  cosmoPoints: false,
  evolutionProgress: false,
  evolutionPoints: false,
  evolutionRedraft: false,
  earlyFinalStageLock: false,
  matchupRoles: false,
};

describe('getFormatCapabilities (full objects)', () => {
  it('singles and doubles share the classic baseline', () => {
    const expected = { ...ALL_OFF, participantTypeAssignment: true, typeCores: true };
    expect(getFormatCapabilities('singles')).toEqual(expected);
    expect(getFormatCapabilities('doubles')).toEqual(expected);
  });

  it('draft is the baseline plus the draft pool flags', () => {
    expect(getFormatCapabilities('draft')).toEqual({
      ...ALL_OFF,
      participantTypeAssignment: true,
      typeCores: true,
      evolutionTiers: true,
      wildcards: true,
      tierLimits: true,
      genericDraftPool: true,
    });
  });

  it('evolution_point_buy has the nine point-buy flags and neither classic participant feature', () => {
    expect(getFormatCapabilities('evolution_point_buy')).toEqual({
      ...ALL_OFF,
      pointBuyList: true,
      draftTokens: true,
      killTokens: true,
      cosmoPoints: true,
      evolutionProgress: true,
      evolutionPoints: true,
      evolutionRedraft: true,
      earlyFinalStageLock: true,
      matchupRoles: true,
    });
  });

  it('has exactly the fifteen flags', () => {
    expect(Object.keys(getFormatCapabilities('singles'))).toHaveLength(15);
  });
});

describe('getFormatCapabilities (custom)', () => {
  it('has every flag off: a kit document starts with no gym types, cores or draft machinery', () => {
    expect(getFormatCapabilities('custom')).toEqual(ALL_OFF);
    expect(Object.isFrozen(getFormatCapabilities('custom'))).toBe(true);
  });
});

