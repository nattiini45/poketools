import { describe, expect, it } from 'vitest';
import { VIEWPORTS, routePoseAt, screenPoint, type ViewportKey } from '@/lib/route-world/data-surfaces';
import { blockToWorld, ledSpecs, plazaBlockPlans, type BlockPlan } from '@/lib/route-world/haussmann';
import { PLAZA } from '@/lib/route-world/layout';
import { CREST_RASTER } from '@/lib/route-world/teams-formation';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';
import { crestWallWords } from '../HaussmannBlock';
import { crestKicker, paintCrestSlide, paintLeagueMark, type CrestCopy, type CrestSlide } from '../LedScreen';

/**
 * Fix r7 (D31 #3) — the rung-2 "teams banner bleed" at RULES. The words that
 * read through the sparse right-hand linden at rung 2 were NOT the teams
 * wall's: the rules pose looks south (screen-right is world −x), so the
 * cropped LED at the frame's right edge is the SOUTH-WEST façade twin, which
 * painted the same carousel. It is no station's face (behind or off-frame
 * at every other pose), so it now shows the crests without words, and the
 * teams wall (east) is untouched.
 */

const PLANS = plazaBlockPlans(PLAZA.half);
const plan = (id: string): BlockPlan => {
  const found = PLANS.find((p) => p.id === id);
  if (!found) throw new Error(id);
  return found;
};

type Frame = 'in' | 'off' | 'behind';

/** Where a block's LED content plane lands at a station pose. */
function ledFrame(block: BlockPlan, station: string, key: ViewportKey): Frame {
  const [spec] = ledSpecs(block);
  const index = PLAZA_STATIONS.findIndex((s) => s.id === station);
  const cam = routePoseAt(PLAZA_STATIONS, index, VIEWPORTS[key]);
  const vp = VIEWPORTS[key];
  const z = block.depth / 2 - spec.recess + 0.14;
  const pts = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => blockToWorld(block, spec.x + (sx * spec.w) / 2, spec.y + (sy * spec.h) / 2, z)));
  const screen = pts.map((p) => screenPoint(p, cam, vp));
  if (screen.some((p) => p === null)) return screen.every((p) => p === null) ? 'behind' : 'in';
  const xs = screen.map((p) => (p as { x: number }).x);
  const ys = screen.map((p) => (p as { y: number }).y);
  const hit = Math.max(...xs) > 0 && Math.min(...xs) < vp.width && Math.max(...ys) > 0 && Math.min(...ys) < vp.height;
  return hit ? 'in' : 'off';
}

describe('which crest wall carries words', () => {
  it('only the east (teams) wall paints the banner words', () => {
    expect(PLANS.filter((p) => ledSpecs(p).length > 0).map((p) => [p.id, crestWallWords(p.id)])).toEqual([
      ['east', true],
      ['south-west', false],
    ]);
  });

  it('the rules frame crops the SOUTH-WEST wall, not the teams wall (1440)', () => {
    expect(ledFrame(plan('south-west'), 'rules', 'desktop')).toBe('in');
    expect(ledFrame(plan('east'), 'rules', 'desktop')).not.toBe('in');
  });

  it('the south-west wall is no other station’s view, so dropping its words costs no data', () => {
    for (const station of PLAZA_STATIONS.map((s) => s.id).filter((id) => id !== 'rules')) {
      for (const key of ['desktop', 'mobile'] as const) {
        expect([station, key, ledFrame(plan('south-west'), station, key)]).not.toEqual([station, key, 'in']);
      }
    }
  });

  it('the teams wall is the one the teams pose frames', () => {
    expect(ledFrame(plan('east'), 'teams', 'desktop')).toBe('in');
  });
});

/** A canvas 2D context stand-in that records every painted string. */
function recordingContext(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const target: Record<string, unknown> = {
    fillText: (text: string) => texts.push(text),
    measureText: (text: string) => ({ width: text.length * 18 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  const ctx = new Proxy(target, {
    get: (obj, key: string) => (key in obj ? obj[key] : () => undefined),
    set: (obj, key: string, value) => {
      obj[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

const DE: CrestCopy = { locale: 'de' };
const SLIDE: CrestSlide = { id: 'p1', name: 'Test Trainer', pigment: '#c03028', ace: 'fixture-ace', place: 1 };

describe('word-free crest slides (the south-west wall)', () => {
  it('paints the banner, ace line and word-mark on the teams wall', () => {
    const { ctx, texts } = recordingContext();
    paintCrestSlide(ctx, CREST_RASTER.w, CREST_RASTER.h, SLIDE, 0, 8, null, true, DE);
    expect(texts).toContain(crestKicker(SLIDE, 0, 8, DE));
    expect(texts).toContain('TEST TRAINER');
    expect(texts).toContain('EVOLIGA');
  });

  it('paints no words at all when `words` is false (the crest initial stays in the hexagon)', () => {
    const { ctx, texts } = recordingContext();
    paintCrestSlide(ctx, CREST_RASTER.w, CREST_RASTER.h, SLIDE, 0, 8, null, false, DE);
    expect(texts).toEqual(['T']);
    const { ctx: markCtx, texts: markTexts } = recordingContext();
    paintLeagueMark(markCtx, CREST_RASTER.w, CREST_RASTER.h, false, DE);
    expect(markTexts).toEqual([]);
  });
});
