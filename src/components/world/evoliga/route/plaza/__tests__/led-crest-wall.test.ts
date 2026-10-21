import { describe, expect, it } from 'vitest';
import { typeColors } from '@/lib/design/tokens';
import type { EvolutionTracker } from '@/types/evolution';
import type { SeasonParticipant } from '@/types/season';
import type { LeagueStanding } from '@/lib/supabase/queries/league-standings';
import { DATA_EMISSIVE_CEILING } from '@/components/world/route/useStandbyDim';
import { CREST_BANNER, CREST_RASTER } from '@/lib/route-world/teams-formation';
import {
  CREST_CAP_EM,
  CREST_EMISSIVE,
  CREST_NAME_PX,
  CREST_TEX_H,
  CREST_TEX_W,
  crestAceLine,
  crestKicker,
  crestSlideLayout,
  crestSlides,
  type CrestCopy,
  type CrestMeasure,
  type CrestSlide,
  type CrestTextLine,
} from '../LedScreen';

/** The crest wall's historical surface language, now passed explicitly (T20). */
const DE: CrestCopy = { locale: 'de' };

function participant(id: string, name: string, gym: string | null): SeasonParticipant {
  return { id, name, gym_type: gym } as unknown as SeasonParticipant;
}

function tracker(playerId: string, base: string, form: string, stage: number, kos: number): EvolutionTracker {
  return {
    player_id: playerId,
    base_pokemon: base,
    current_form: form,
    current_stage: stage,
    total_kos: kos,
  } as unknown as EvolutionTracker;
}

function standing(playerId: string): LeagueStanding {
  return { player_id: playerId } as unknown as LeagueStanding;
}

// Fixture species are opaque strings: the carousel shows whatever the data names.
const people = [participant('a', 'Ada', 'Fire'), participant('b', 'Ben', null), participant('c', 'Cleo', 'NoSuchType')];
const trackers = [
  tracker('a', 'line-a-base', 'line-a-mid', 2, 1),
  tracker('a', 'line-a2-base', 'line-a2-top', 3, 0),
  tracker('c', 'line-c-base', 'line-c-base', 1, 4),
];

describe('crestSlides — the LED wall follows the table', () => {
  it('orders slides by the standings, then unlisted participants in data order', () => {
    const slides = crestSlides(people, trackers, [standing('c'), standing('a')]);
    expect(slides.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(slides.map((s) => s.place)).toEqual([1, 2, null]);
  });

  it("picks the statue row's ace: most evolved line, then KOs; none without a tracker", () => {
    const slides = crestSlides(people, trackers, []);
    expect(slides.find((s) => s.id === 'a')?.ace).toBe('line-a2-top');
    expect(slides.find((s) => s.id === 'b')?.ace).toBeNull();
  });

  it('paints the gym colour, neutral for none or an unknown type', () => {
    const slides = crestSlides(people, trackers, []);
    expect(slides[0].pigment).toBe(typeColors.Fire.bg);
    expect(slides[1].pigment).toBe(typeColors.Normal.bg);
    expect(slides[2].pigment).toBe(typeColors.Normal.bg);
  });

  it('ignores standings rows for non-participants and duplicate rows', () => {
    const slides = crestSlides(people, trackers, [standing('zz'), standing('a'), standing('a')]);
    expect(slides.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(slides[0].place).toBe(1);
  });

  it('has no slides without participants (the league-mark fallback paints)', () => {
    expect(crestSlides([], [], [])).toEqual([]);
  });
});

describe('crest copy is German (the plaza)', () => {
  it('kicker and ace line', () => {
    const [slide] = crestSlides(people, trackers, [standing('a')]);
    expect(crestKicker(slide, 0, 3, DE)).toBe('TRAINER 1/3 · PLATZ 1');
    expect(crestAceLine(slide, DE)).toBe('ASS · LINE-A2-TOP');
    const unplaced = crestSlides([participant('x', 'Xa', null)], [], [])[0];
    expect(crestKicker(unplaced, 1, 2, DE)).toBe('TRAINER 2/2');
    expect(crestAceLine(unplaced, DE)).toBeNull();
  });
});

/**
 * A width model of the bold uppercase crest face: 0.68 em per glyph, a bit
 * wider than Segoe UI / system-ui bold caps, so the fit is tested on the
 * generous side (the painter measures the real face).
 */
const measure: CrestMeasure = (text, font) => {
  const px = Number(/(\d+)px/.exec(font)?.[1] ?? 0);
  return text.length * px * 0.68;
};

function slideOf(name: string, ace: string | null, place: number | null): CrestSlide {
  return { id: 'x', name, pigment: '#888888', ace, place };
}

/** The raster box a line's glyphs occupy (cap top to baseline; the faces are set in capitals). */
function lineBox(line: CrestTextLine) {
  const x0 = line.align === 'left' ? line.x : line.x - line.width;
  return { x0, x1: x0 + line.width, y0: line.baseline - line.px * CREST_CAP_EM, y1: line.baseline };
}

describe('LOOK r6 (C2): the crest words live in the top banner, above the rear-rank crowns', () => {
  const cases: [string, CrestSlide, number, number][] = [
    ['r5 live-length name', slideOf('Mara Feldkamp', 'line-ace', 1), 0, 8],
    ['long name + long ace', slideOf('Lea-Sophie Hofstetter-Brandt', 'a-very-long-ace-name', 12), 11, 12],
    ['no ace, unplaced', slideOf('Xa', null, null), 1, 2],
    ['pathological name', slideOf('W'.repeat(60), 'w', 3), 2, 3],
  ];

  it('paints on the shared raster (teams-formation CREST_RASTER)', () => {
    expect([CREST_TEX_W, CREST_TEX_H]).toEqual([CREST_RASTER.w, CREST_RASTER.h]);
  });

  for (const [label, slide, index, total] of cases) {
    it(`${label}: text block ends above h·0.36 and inside the banner`, () => {
      const layout = crestSlideLayout(slide, index, total, measure, DE);
      const lines = [layout.kicker, layout.name, ...(layout.ace ? [layout.ace] : [])];
      const bottom = Math.max(...lines.map((l) => lineBox(l).y1));
      // The R6-BRIEF bound, and the banner's own (0.13 h) — the formation test projects it.
      expect(bottom).toBeLessThanOrEqual(CREST_RASTER.h * 0.36);
      expect(bottom).toBeLessThanOrEqual(CREST_BANNER.bottom);
      for (const line of [layout.kicker, layout.name]) {
        const box = lineBox(line);
        expect(box.y0, `${line.text} cap top`).toBeGreaterThanOrEqual(CREST_BANNER.top - 1e-9);
        expect(box.x0).toBeGreaterThanOrEqual(CREST_BANNER.left);
        expect(box.x1, `${line.text} right edge`).toBeLessThanOrEqual(CREST_BANNER.right + 1e-9);
        expect(line.maxWidth).toBe(CREST_BANNER.right - CREST_BANNER.left);
      }
      // Kicker above the name, never touching it.
      expect(lineBox(layout.kicker).y1).toBeLessThan(lineBox(layout.name).y0);
      if (layout.ace) {
        const ace = lineBox(layout.ace);
        expect(ace.x0).toBeGreaterThan(lineBox(layout.kicker).x1);
        expect(ace.x1).toBeLessThanOrEqual(CREST_RASTER.w);
        expect(layout.ace.baseline).toBe(layout.kicker.baseline);
      }
      // The decorative hexagon (and its 10 px stroke) stays under the banner.
      expect(layout.hex.cy - layout.hex.r - 5).toBeGreaterThan(CREST_BANNER.bottom);
      expect(layout.hex.cy + layout.hex.r + 5).toBeLessThanOrEqual(CREST_RASTER.h);
    });
  }

  it('keeps a whole live-length name at its start size (cap 36 raster px), words unchanged', () => {
    const layout = crestSlideLayout(slideOf('Mara Feldkamp', null, 1), 0, 8, measure, DE);
    expect(layout.kicker.text).toBe('TRAINER 1/8 · PLATZ 1');
    expect(layout.name.text).toBe('MARA FELDKAMP');
    expect(layout.name.px).toBe(CREST_NAME_PX.start);
    expect(layout.name.baseline).toBe(CREST_BANNER.bottom);
  });

  it('shows the ace line beside the kicker when it fits, and drops it (never overlaps) when not', () => {
    const fits = crestSlideLayout(slideOf('Mara Feldkamp', 'line-ace', 1), 0, 8, measure, DE);
    expect(fits.ace?.text).toBe('ASS · LINE-ACE');
    const crowded = crestSlideLayout(slideOf('Mara Feldkamp', 'x'.repeat(40), 10), 9, 12, measure, DE);
    expect(crowded.ace).toBeNull();
  });
});

describe('the wall is chrome, under the boards', () => {
  it('emits at 40 %, far under the data ceiling', () => {
    expect(CREST_EMISSIVE).toBe(0.4);
    expect(CREST_EMISSIVE).toBeLessThan(DATA_EMISSIVE_CEILING);
  });
});
