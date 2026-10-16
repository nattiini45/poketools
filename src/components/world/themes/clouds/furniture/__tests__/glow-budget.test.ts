import { describe, expect, it } from 'vitest';
import type { WorldPalette } from '@/lib/route-world/palette';
import { cloudsPaletteExtension } from '../../theme-palette';
import { linearLuminance } from '@/components/world/route/useStandbyDim';
import { bridgeEmissive } from '../LightBridges';
import { GLOW_UNDER_INK, PLAQUE_EMISSION, PLAQUE_INK, inlayEmissive } from '../SkyGate';

/**
 * Fidelity wave 2 (2F LUMA): the clouds glow lines — light-bridge beams and
 * rings, the halo gate's inlay — emit at most 0.6 × the dimmest clouds
 * board's ink luminance (the rules plaque), day and night.
 */
const core = (night: boolean) => ({ ground: night ? '#000000' : '#ffffff' }) as unknown as WorldPalette;

describe('clouds glow lines sit under the boards', () => {
  for (const night of [false, true]) {
    const palette = cloudsPaletteExtension(core(night), night);
    const inkLum = linearLuminance(PLAQUE_INK) * (night ? PLAQUE_EMISSION.night : PLAQUE_EMISSION.day);
    const cap = GLOW_UNDER_INK * inkLum + 1e-9;

    it(`${night ? 'night' : 'day'}: bridge beam and rings ≤ 0.6 × board ink`, () => {
      expect(bridgeEmissive('beam', palette.bridgeGlow, night) * linearLuminance(palette.bridgeGlow)).toBeLessThanOrEqual(cap);
      expect(bridgeEmissive('ring', palette.bridgeRing, night) * linearLuminance(palette.bridgeRing)).toBeLessThanOrEqual(cap);
    });

    it(`${night ? 'night' : 'day'}: the halo gate inlay ≤ 0.6 × board ink`, () => {
      expect(inlayEmissive(palette.boardAccent, night) * linearLuminance(palette.boardAccent)).toBeLessThanOrEqual(cap);
    });
  }

  it('the night beam no longer outshines the plaque (was 7.0 → ≈ 5.2 luminance)', () => {
    const palette = cloudsPaletteExtension(core(true), true);
    expect(bridgeEmissive('beam', palette.bridgeGlow, true)).toBeLessThan(1);
  });
});
