import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isRetryableLiteReason,
  postPassesFrom,
  QUALITY_LADDER,
  rungCastsShadow,
} from '../quality';

/**
 * D23 (LOOK-PLAN §2 G5): a governor step after the reveal links 0 programs
 * and uploads 0 asset textures. The ladder may shed DPR (render-target
 * reallocations, reported separately by the quiet probe), post `.enabled`,
 * shadow cadence and strength — never anything that is a program key or an
 * asset allocation: the shadow map size, a light's `castShadow`, or the tone
 * mapping operator.
 */
describe('quality ladder invariance (D23)', () => {
  it('no rung changes shadowMapSize: 1024 everywhere (the shadow target is never reallocated)', () => {
    for (const step of QUALITY_LADDER) expect(step.shadowMapSize).toBe(1024);
  });

  it('no rung changes castShadow (a shadow program key), however the lights are counted', () => {
    const casts = QUALITY_LADDER.map(rungCastsShadow);
    expect(new Set(casts)).toEqual(new Set([true]));
    // Every world's Lighting derives castShadow from these two fields.
    for (const step of QUALITY_LADDER) expect(step.shadowedLights > 0 && step.shadowMapSize > 0).toBe(true);
  });

  it('sheds shadows through cadence and strength only: rung 3 on-move, rung 4 intensity 0', () => {
    expect(QUALITY_LADDER.map((step) => step.shadowUpdate)).toEqual(['always', 'always', 'always', 'on-move', 'on-move']);
    expect(QUALITY_LADDER.map((step) => step.shadowIntensity)).toEqual([1, 1, 1, 1, 0]);
  });

  it('the look fields are declared once, up front, and never climb (D11)', () => {
    expect(QUALITY_LADDER.map((step) => step.puddleEmitters)).toEqual([8, 6, 4, 2, 0]);
    expect(QUALITY_LADDER.map((step) => step.cloudTaps)).toEqual([2, 2, 1, 1, 1]);
    // R6 E9 (R6-BRIEF L4a): rung 1 keeps two beams, rung 2 the one hero seat.
    expect(QUALITY_LADDER.map((step) => step.lightShafts)).toEqual([3, 2, 1, 0, 0]);
    for (let i = 1; i < QUALITY_LADDER.length; i += 1) {
      expect(QUALITY_LADDER[i].puddleEmitters).toBeLessThanOrEqual(QUALITY_LADDER[i - 1].puddleEmitters);
      expect(QUALITY_LADDER[i].cloudTaps).toBeLessThanOrEqual(QUALITY_LADDER[i - 1].cloudTaps);
    }
  });

  it('the output path per rung is the shipped one (LOOK r2 decision): AgX composer with post, renderer ACES without', () => {
    // PostStack: the composer (… + AgX, straight to screen) while `post`;
    // post off = the renderer's ACES (the lean full-screen AgX graded the
    // data faces, which ACES never touches — they are toneMapped: false).
    const route = join(process.cwd(), 'src', 'components', 'world', 'route');
    const canvas = readFileSync(join(route, 'RouteWorldCanvas.tsx'), 'utf8');
    // ENGINE r3: `onCreated` sets the START rung's operator (none under the
    // composer, ACES post-off) — a blanket none overwrote PostStack's ACES on
    // a post-off start rung (the r2 rung-2 cold-load Lite fall).
    expect(canvas).toMatch(/gl\.toneMapping = outputPathFor\(QUALITY_LADDER\[qualityIndex\]\)\.toneMapping;/);
    expect(canvas).not.toMatch(/gl\.toneMapping = THREE\.NoToneMapping;/);
    const post = readFileSync(join(route, 'post', 'PostStack.tsx'), 'utf8');
    expect(post).toMatch(/POST_OFF_TONE_MAPPING = THREE\.ACESFilmicToneMapping/);
    expect(post).toMatch(/ROUTE_TONE_MAPPING_EXPOSURE = 1\.05/);
    // D42 N3: only the AO pass joins `groupPasses` (as the library's <N8AO> did).
    expect(post.match(/groupPasses\.add\(/g) ?? []).toHaveLength(1);
    expect(post).toMatch(/groupPasses\.add\(instance\);/);
  });

  it('the load warm covers every pass the start rung and every LOWER rung can draw', () => {
    expect(postPassesFrom(0)).toEqual({ rich: true, lean: true, ao: true });
    expect(postPassesFrom(1)).toEqual({ rich: true, lean: true, ao: false });
    expect(postPassesFrom(2)).toEqual({ rich: false, lean: true, ao: false });
    expect(postPassesFrom(4)).toEqual({ rich: false, lean: true, ao: false });
    // Out-of-range starts clamp to the ladder.
    expect(postPassesFrom(-3)).toEqual(postPassesFrom(0));
    expect(postPassesFrom(99)).toEqual(postPassesFrom(4));
  });

  it('a stall is a recoverable Lite (a retry is offered), like the deadline', () => {
    expect(isRetryableLiteReason('readiness-stall')).toBe(true);
    expect(isRetryableLiteReason('readiness-timeout')).toBe(true);
  });
});
