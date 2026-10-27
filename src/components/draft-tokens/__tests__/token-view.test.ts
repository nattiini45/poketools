import { describe, expect, it } from 'vitest';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import type { LineId } from '@/types/draft-queue';
import {
  COMEBACK_MAX_LINES,
  COMEBACK_MAX_PER_LINE,
  allocatedTotal,
  comebackPreview,
  comebackStep,
  maxForLine,
  refusalParams,
  toAllocations,
  visibleRefusal,
  type DraftKillLine,
  type TokenLine,
} from '../token-view';

function entry(lineId: string, names: string[], cumulative: [number, number | null]): DraftLineCatalogEntry {
  return {
    lineId: lineId as LineId,
    entryId: `e-${lineId}`,
    lineNumber: 1,
    price: 20,
    stages: names.map((name, i) => ({ stage: (i + 1) as 1 | 2 | 3, name, speciesId: name.toLowerCase() })),
    thresholds: { toStage2: cumulative[0], additionalToStage3: cumulative[1], cumulative },
    flags: { cosmog: false, noRedraft: false, scatterbugCocoon: false },
    specialRules: null,
    branch: { groupKey: names[0].toLowerCase(), count: 1 },
  };
}

function line(overrides: Partial<TokenLine> = {}): TokenLine {
  return {
    line_id: 'charmander--charizard' as LineId,
    stage: 1,
    self_earned_kills: 2,
    transferred_evo_progress: 0,
    draft_token_progress: 0,
    comeback_token_progress: 0,
    cosmo_token_progress: 0,
    total_progress: 2,
    next_threshold: 3,
    comeback_tokens_per_progress: 1,
    ...overrides,
  };
}

const CHAR = entry('charmander--charizard', ['Charmander', 'Charmeleon', 'Charizard'], [3, 7]);

describe('comebackPreview', () => {
  it('shows the progress without evolving below the threshold', () => {
    const p = comebackPreview(line({ total_progress: 1 }), 1, CHAR);
    expect(p).toMatchObject({ from: 1, to: 2, next: 3, stageBefore: 1, stageAfter: 1, evolvesTo: null });
  });

  it('evolves to stage 2 when the threshold is reached and names the form', () => {
    const p = comebackPreview(line(), 1, CHAR);
    expect(p).toMatchObject({ to: 3, next: 7, stageAfter: 2, evolvesTo: 'Charmeleon' });
  });

  it('may evolve two stages at once', () => {
    const p = comebackPreview(line(), 5, CHAR);
    expect(p).toMatchObject({ to: 7, next: null, stageAfter: 3, evolvesTo: 'Charizard' });
  });

  it('a two-stage line stops at stage 2', () => {
    const two = entry('pawniard--kingambit', ['Pawniard', 'Bisharp'], [4, null]);
    const p = comebackPreview(line({ line_id: 'pawniard--kingambit' as LineId, total_progress: 3, next_threshold: 4 }), 3, two);
    expect(p).toMatchObject({ to: 6, next: null, stageAfter: 2, evolvesTo: 'Bisharp' });
  });

  it('uses override-aware catalog thresholds (an overridden line at 5/10)', () => {
    const overridden = entry('dratini--dragonite', ['Dratini', 'Dragonair', 'Dragonite'], [5, 10]);
    const row = line({ line_id: 'dratini--dragonite' as LineId, stage: 2, total_progress: 7, next_threshold: 10 });
    expect(comebackPreview(row, 2, overridden)).toMatchObject({ to: 9, next: 10, evolvesTo: null });
    expect(comebackPreview(row, 3, overridden)).toMatchObject({ to: 10, next: null, stageAfter: 3, evolvesTo: 'Dragonite' });
  });

  it('falls back to the DTO threshold for a line the catalog does not know', () => {
    const p = comebackPreview(line(), 1, undefined);
    expect(p).toMatchObject({ to: 3, next: null, stageAfter: 2, evolvesTo: null });
    expect(comebackPreview(line(), 0, undefined)).toMatchObject({ to: 2, next: 3, stageAfter: 1 });
  });
});

describe('comebackPreview with a per-line tokens-per-progress rate', () => {
  it('2 tokens per progress point: 4 tokens add 2 progress', () => {
    const p = comebackPreview(line({ total_progress: 0, comeback_tokens_per_progress: 2 }), 4, CHAR);
    expect(p).toMatchObject({ tokens: 4, added: 2, from: 0, to: 2, next: 3, stageAfter: 1 });
  });

  it('an odd remainder adds no progress (the RPC refuses it; the stepper never offers it)', () => {
    expect(comebackPreview(line({ total_progress: 0, comeback_tokens_per_progress: 2 }), 3, CHAR)).toMatchObject({ added: 1, to: 1 });
    expect(comebackPreview(line({ total_progress: 0, comeback_tokens_per_progress: 2 }), 1, CHAR)).toMatchObject({ added: 0, to: 0 });
  });

  it('evolves only when the converted progress reaches the threshold', () => {
    const row = line({ total_progress: 2, comeback_tokens_per_progress: 2 });
    expect(comebackPreview(row, 2, CHAR)).toMatchObject({ to: 3, stageAfter: 2, evolvesTo: 'Charmeleon' });
    expect(comebackPreview(row, 2, undefined)).toMatchObject({ to: 3, stageAfter: 2 });
  });

  it('comebackStep is the line rate, never below 1', () => {
    expect(comebackStep(line({ comeback_tokens_per_progress: 2 }))).toBe(2);
    expect(comebackStep(line({ comeback_tokens_per_progress: 1 }))).toBe(1);
    expect(comebackStep(line({ comeback_tokens_per_progress: 0 }))).toBe(1);
  });
});

describe('allocation helpers', () => {
  const a = 'a--a' as LineId;
  const b = 'b--b' as LineId;

  it('toAllocations keeps line order and drops zeros', () => {
    const counts = new Map<LineId, number>([
      [b, 2],
      [a, 0],
    ]);
    expect(toAllocations(counts, [a, b])).toEqual([{ line_id: b, tokens: 2 }]);
    expect(allocatedTotal(counts)).toBe(2);
  });

  it('maxForLine is bounded by the balance left after other lines and by the per-line cap', () => {
    const counts = new Map<LineId, number>([[a, 3]]);
    expect(maxForLine(counts, b, 5)).toBe(2);
    expect(maxForLine(counts, a, 5)).toBe(5);
    expect(maxForLine(new Map(), a, 50)).toBe(COMEBACK_MAX_PER_LINE);
  });

  it('maxForLine rounds down to whole steps of the line rate', () => {
    const counts = new Map<LineId, number>([[a, 2]]);
    expect(maxForLine(counts, b, 5, 2)).toBe(2); // 3 left → 2
    expect(maxForLine(counts, a, 5, 2)).toBe(4); // 5 → 4
    expect(maxForLine(counts, b, 3, 2)).toBe(0); // 1 left → nothing
    expect(maxForLine(new Map(), a, 50, 3)).toBe(COMEBACK_MAX_PER_LINE - (COMEBACK_MAX_PER_LINE % 3));
  });

  it('maxForLine is 0 for a new line once the request has its maximum of lines', () => {
    const counts = new Map<LineId, number>(
      Array.from({ length: COMEBACK_MAX_LINES }, (_, i) => [`l${i}--x` as LineId, 1] as const),
    );
    expect(maxForLine(counts, 'new--x' as LineId, 100)).toBe(0);
    expect(maxForLine(counts, 'l0--x' as LineId, 100)).toBe(COMEBACK_MAX_PER_LINE);
  });
});

describe('Draft Kill Token refusals', () => {
  function dkLine(overrides: Partial<DraftKillLine>): DraftKillLine {
    return {
      line_id: 'a--a' as LineId,
      has_token: false,
      tokens_used: 1,
      cost: 3,
      progress: 2,
      next_threshold: 3,
      eligible: false,
      reason: 'TOKEN_WOULD_EVOLVE',
      ...overrides,
    };
  }

  it('rows show line-level reasons only; window and player limit are card-level', () => {
    expect(visibleRefusal(dkLine({}))).toBe('TOKEN_WOULD_EVOLVE');
    expect(visibleRefusal(dkLine({ reason: 'TOKEN_POINTS_SHORT' }))).toBe('TOKEN_POINTS_SHORT');
    expect(visibleRefusal(dkLine({ reason: 'TOKEN_WINDOW_CLOSED' }))).toBeNull();
    expect(visibleRefusal(dkLine({ reason: 'TOKEN_PLAYER_LIMIT' }))).toBeNull();
    expect(visibleRefusal(dkLine({ eligible: true, reason: null }))).toBeNull();
    // A line that has its token shows the "Token used" badge instead.
    expect(visibleRefusal(dkLine({ has_token: true, reason: 'TOKEN_LINE_LIMIT' }))).toBeNull();
  });

  it('params come from the DTO', () => {
    expect(refusalParams(dkLine({}), { max: 2, owned: 0, unspent_points: 1 })).toEqual({
      progress: 2,
      next: 3,
      max: 2,
      cost: 3,
      unspent: 1,
      tokens: 1,
      left: 2,
    });
  });

  it('a participation line shows the allowance refusal while the player still owns fewer than max', () => {
    const two = dkLine({ reason: 'TOKEN_PLAYER_LIMIT', tokens_used: 2, cost: 6 });
    expect(visibleRefusal(two, { owned: 1, max: 2 })).toBe('TOKEN_PLAYER_LIMIT');
    // At the cap the card-level note says it once.
    expect(visibleRefusal(two, { owned: 2, max: 2 })).toBeNull();
    // A one-token line never repeats the card-level limit, and without the card context neither does a 2-token one.
    expect(visibleRefusal(dkLine({ reason: 'TOKEN_PLAYER_LIMIT' }), { owned: 1, max: 2 })).toBeNull();
    expect(visibleRefusal(two)).toBeNull();
  });

  it('params use the line own price and weight, and the tokens left in the allowance', () => {
    expect(refusalParams(dkLine({ tokens_used: 2, cost: 6 }), { max: 2, owned: 1, unspent_points: 4 })).toMatchObject({
      cost: 6,
      tokens: 2,
      left: 1,
      unspent: 4,
    });
  });
});
