import { describe, expect, it } from 'vitest';
import { getFormatCapabilities, type FormatCapabilities } from '@/lib/season/format-capabilities';
import { deriveCapabilities } from '../engine/capabilities';
import { classicLeague } from '../presets/classic-league';
import { cup } from '../presets/cup';
import { swissTopCut } from '../presets/swiss-top-cut';
import type { FormatDefinition, LegacyModule } from '../types';

const legacyModule = (adapter: LegacyModule['adapter']): LegacyModule => ({ kind: 'module.legacy', adapter, facts: [] });
const withModules = (...adapters: LegacyModule['adapter'][]): FormatDefinition => ({
  ...classicLeague,
  modules: adapters.map(legacyModule),
});

const FLAGS = Object.keys(getFormatCapabilities('singles')) as (keyof FormatCapabilities)[];

describe('deriveCapabilities', () => {
  it('turns every flag off for a document without legacy modules', () => {
    for (const def of [classicLeague, cup, swissTopCut]) {
      const caps = deriveCapabilities(def);
      expect(FLAGS).toHaveLength(15);
      for (const flag of FLAGS) expect(caps[flag], flag).toBe(false);
    }
  });

  it('matches the legacy shape: same 15 keys, all booleans', () => {
    const caps = deriveCapabilities(classicLeague) satisfies FormatCapabilities;
    expect(Object.keys(caps).sort()).toEqual(Object.keys(getFormatCapabilities('singles')).sort());
    expect(Object.values(caps).every((v) => typeof v === 'boolean')).toBe(true);
  });

  it.each([
    ['epb', 'evolution_point_buy'],
    ['legacy_draft', 'draft'],
    ['core_liga', 'singles'],
  ] as const)('a %s module gives the capabilities of %s, flag by flag', (adapter, format) => {
    const caps = deriveCapabilities(withModules(adapter));
    const legacy = getFormatCapabilities(format);
    for (const flag of FLAGS) expect(caps[flag], flag).toBe(legacy[flag]);
  });

  it('merges two modules with OR', () => {
    const caps = deriveCapabilities(withModules('epb', 'legacy_draft'));
    const epb = getFormatCapabilities('evolution_point_buy');
    const draft = getFormatCapabilities('draft');
    for (const flag of FLAGS) expect(caps[flag], flag).toBe(epb[flag] || draft[flag]);
    expect(caps.pointBuyList).toBe(true);
    expect(caps.genericDraftPool).toBe(true);
  });

  it('returns a fresh object each time', () => {
    const a = deriveCapabilities(classicLeague);
    const b = deriveCapabilities(classicLeague);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
