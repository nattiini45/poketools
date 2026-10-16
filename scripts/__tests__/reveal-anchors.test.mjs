/**
 * Rollout harness (CAR judge r11): reveal since generationBegunAt AND since
 * navigation in every loader sidecar (scripts/lib/reveal-anchors.mjs).
 */
import { describe, expect, it } from 'vitest';
import { revealAnchors, revealLine } from '../lib/reveal-anchors.mjs';

describe('revealAnchors', () => {
  it('reports both anchors, the generation log and the late links', () => {
    const r = revealAnchors({
      routeLiveAt: 11687.4,
      generationBegunAt: 3040.2,
      bridges: { generationLog: [{ t: 3040.2, generation: 1, kind: 'begin' }], warmAudit: { generation: 1, armed: true, programsAtArm: 69, lateLinks: 0, late: [] }, errors: [] },
    });
    expect(r.sinceGenerationBegunMs).toBe(8647.2);
    expect(r.sinceNavigationMs).toBe(11687.4);
    expect(r.anchorSource).toBe('generationBegunAt');
    expect(r.lateLinks).toBe(0);
    expect(r.generationLog).toHaveLength(1);
    expect(revealLine(r)).toBe('reveal=8647ms since generationBegunAt (11687ms since navigation) lateLinks=0 generationLog=1');
  });

  it('missing anchors and bridges read null, never 0', () => {
    const r = revealAnchors({ routeLiveAt: null, generationBegunAt: 2000 });
    expect(r.sinceGenerationBegunMs).toBeNull();
    expect(r.lateLinks).toBeNull();
    expect(r.generationLog).toBeNull();
    const noGen = revealAnchors({ routeLiveAt: 9000, generationBegunAt: null, bridges: { errors: ['readiness: boom'] } });
    expect(noGen.anchorSource).toBeNull();
    expect(noGen.bridgeErrors).toEqual(['readiness: boom']);
    expect(revealLine(noGen)).toBe('reveal=n/a since generationBegunAt (9000ms since navigation)');
    expect(revealLine(null)).toBe('reveal=n/a');
  });
});
