import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUALITY_LADDER } from '@/lib/route-world/quality';
import * as THREE from 'three';
import {
  bloomKneeFor,
  outputPathFor,
  POST_OFF_TONE_MAPPING,
  ROUTE_TONE_MAPPING_EXPOSURE,
  vignetteDarknessFor,
} from '../post/PostStack';
import { shadowRungPlan } from '../QualityGovernor';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { sakuraTheme } from '@/components/world/themes/sakura/theme';
import { mountainTheme } from '@/components/world/themes/mountain/theme';
import { cloudsTheme } from '@/components/world/themes/clouds/theme';

/**
 * Output path (design decision, supersedes the D23 always-mounted lean
 * AgX pass): the shipped pipeline. With post the composer runs N8AO (when
 * `ao`) and ONE merged Bloom + SMAA + Vignette + AgX pass that renders
 * straight to the screen (no trailing copy); without post the renderer's
 * ACES draws, exactly as every world shipped — a full-screen AgX pass graded
 * the `toneMapped: false` data faces at rung 2 and cannot exclude them.
 * Exposure is the shipped 1.05 in both paths (its loss was the −1…−2 LSB
 * blast-radius shift in every world).
 */
const ROUTE = join(process.cwd(), 'src', 'components', 'world', 'route');
const postSource = readFileSync(join(ROUTE, 'post', 'PostStack.tsx'), 'utf8');

describe('route output path (LOOK r2)', () => {
  it('post rungs use the composer with no renderer operator; post-off rungs use renderer ACES', () => {
    for (const step of QUALITY_LADDER) {
      const path = outputPathFor(step);
      expect(path.composer).toBe(step.post);
      expect(path.ao).toBe(step.post && step.ao);
      expect(path.toneMapping).toBe(step.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping);
    }
    expect(POST_OFF_TONE_MAPPING).toBe(THREE.ACESFilmicToneMapping);
  });

  it('keeps the shipped exposure', () => {
    expect(ROUTE_TONE_MAPPING_EXPOSURE).toBe(1.05);
    expect(postSource).toMatch(/gl\.toneMappingExposure = ROUTE_TONE_MAPPING_EXPOSURE/);
  });

  it('the rich pass is the last pass (renders to screen): no forced trailing copy, one merged pass', () => {
    // D42 N3: the only `groupPasses` member is the AO pass, exactly as the
    // library's `<N8AO>` wrapper registered its own (RouteN8AO replaces the
    // wrapper line for line) — PostStack never forces a copy for the rich pass.
    expect(postSource.match(/groupPasses\.add\(/g) ?? []).toHaveLength(1);
    expect(postSource).toMatch(/const instance = new ExactN8AOPostPass\(scene, camera\);\r?\n\s*groupPasses\.add\(instance\);/);
    expect(postSource).not.toMatch(/groupPasses\.add\((passes\.)?rich\)/);
    expect(postSource).toMatch(/new EffectPass\(camera, bloom, smaa, vignette, tone\)/);
    expect(postSource).toMatch(/ToneMappingMode\.AGX/);
    // Its warm draw links the screen variant without writing a pixel.
    expect(postSource).toMatch(/gl\.setScissor\(0, 0, 0, 0\)/);
  });

  it('look inputs are uniforms: bloom knee per palette, vignette per theme (plaza 0.30; others unchanged 0.46)', () => {
    expect(bloomKneeFor(true)).toEqual({ threshold: 2.0, smoothing: 0.25 });
    expect(bloomKneeFor(false)).toEqual({ threshold: 1.7, smoothing: 0.3 });
    // ROLLOUT §2.2 (k): the vignette is the theme's paint-block field (plaza 0.30); no block → 0.46.
    expect(vignetteDarknessFor(plazaTheme)).toBe(0.3);
    for (const other of [sakuraTheme, mountainTheme, cloudsTheme, null, undefined]) expect(vignetteDarknessFor(other)).toBe(0.46);
  });
});

describe('shadow rung plan (D23: cadence and strength, never castShadow or the map)', () => {
  it('rungs 0–2 keep three auto-updating at full strength (pixel-neutral)', () => {
    for (const step of QUALITY_LADDER.slice(0, 3)) {
      expect(shadowRungPlan(step)).toEqual({ autoUpdate: true, updateOnMove: false, zeroIntensity: false });
    }
  });

  it('rung 3 re-renders the map only when the camera moved', () => {
    expect(shadowRungPlan(QUALITY_LADDER[3])).toEqual({ autoUpdate: false, updateOnMove: true, zeroIntensity: false });
  });

  it('rung 4 scales the shadow term to 0 and never re-renders the map', () => {
    expect(shadowRungPlan(QUALITY_LADDER[4])).toEqual({ autoUpdate: false, updateOnMove: false, zeroIntensity: true });
  });
});
