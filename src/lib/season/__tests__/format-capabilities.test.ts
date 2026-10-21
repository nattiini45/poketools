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
