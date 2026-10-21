import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GATE_DAY_MATERIAL_TONE, materialTone, toneFor } from '../ChallengeGate';

/**
 * PR #65 test pass, R18d: the plaza route scene logged
 * "[paint] 4 lit material(s) unpatched after world-route-live" once a second.
 *
 * `useGateMaterials` memoizes the seven challenge-gate materials on
 * `[maps, tone]`, and by day `tone` came from `materialTone`, which spread a
 * NEW object on every call — so every ChallengeGate render rebuilt them all.
 * After the reveal the paint sweep no longer patches (a patch would be a
 * program link after reveal, D23), so a re-render (a Tafel panel opening or
 * closing) left four new unpainted lit materials in the scene: ashlar,
 * dressed, shade and cavity (brass, glass and iron are exempt frames). The
 * audit was right; the materials really missed the patch.
 */
describe('challenge gate material tone', () => {
  it('is the same object for the same paint tone, by day and by night', () => {
    const day = toneFor(false);
    expect(materialTone(false, day)).toBe(materialTone(false, day));
    const night = toneFor(true);
    expect(materialTone(true, night)).toBe(night);
  });

  it('still lays the honey day stone over the paint tone', () => {
    const day = toneFor(false);
    expect(materialTone(false, day)).toStrictEqual({ ...day, ...GATE_DAY_MATERIAL_TONE });
    // The paint tone itself (the frieze, plaques and board inks) is untouched.
    expect(day.dressed).toBe('#e6dac4');
  });

  it('the gate materials memo keys on that tone, so a re-render reuses the painted materials', () => {
    const source = readFileSync(join(__dirname, '..', 'ChallengeGate.tsx'), 'utf8');
    expect(source).toMatch(/const tone = materialTone\(night, paintTone\);/);
    expect(source).toMatch(/\[maps, tone\],\s*\);/);
  });
});
