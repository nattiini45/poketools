/**
 * C-042: rank-change glyphs on the Tabelle.
 *
 * Covers the full seam chain: the pure derivation in the standings query
 * (league-standings.ts), the preview fixtures' DB-free mirror of it, the
 * board-content passthrough (bar-hygiene law: derived data must reach the
 * painter, not stop at the query), and the painter's glyph mapping at exact
 * canvas coordinates.
 */
import { describe, expect, it } from 'vitest';
import { completedMatchdays, deriveRankChanges } from '@/lib/supabase/queries/league-standings';
import {
  hexA,
  paintTableBoard,
  rankMoveColor,
  rankMoveGlyph,
  type BoardTheme,
} from '@/components/world/evoliga/route/plaza/board/board-painters';
import { buildBoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import { buildPreviewWorld } from '@/app/(public)/route-preview/fixtures';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { Standing } from '@/lib/tournament/types';
import type { MatchWithPlayers } from '@/types/match';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function standing(playerId: string, points: number): Standing {
  return {
    player_id: playerId,
    player_name: playerId,
    player_avatar_url: null,
    gym_type: null,
    wins: points,
    losses: 0,
    draws: 0,
    points,
    buchholz: 0,
    games_played: 0,
    kill_differential: 0,
    eliminated: false,
  };
}

let matchSeq = 0;

/** One completed (or scheduled) league fixture with the minimum real shape. */
function fixture(partial: {
  round: string;
  kickoff: string;
  status?: 'completed' | 'scheduled';
  winner?: string;
  p1?: string;
  p2?: string;
}): LeagueFixture {
  matchSeq += 1;
  const p1 = partial.p1 ?? 'player-a';
  const p2 = partial.p2 ?? 'player-b';
  const done = (partial.status ?? 'completed') === 'completed';
  const match: MatchWithPlayers = {
    id: `match-${matchSeq}`,
    round_id: partial.round,
    tournament_id: 'stage-1',
    player_1_id: p1,
    player_2_id: p2,
    winner_id: done ? (partial.winner ?? p1) : null,
    status: done ? 'completed' : 'scheduled',
    submitter_id: null,
    date_played: done ? partial.kickoff : null,
    scheduled_at: partial.kickoff,
    auto_confirm_at: null,
    confirmed_at: done ? partial.kickoff : null,
    notes: '',
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: partial.kickoff,
    updated_at: partial.kickoff,
    player_1_name: 'Ada Bäcker',
    player_2_name: 'Ben Clausen',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: done ? 'Ada Bäcker' : null,
    round_status: done ? 'completed' : 'active',
    games: [],
  };
  return { stageId: 'stage-1', stageName: 'Hinrunde', match };
}

/**
 * Two played matchdays plus a scheduled third — the season shape the movement
 * column is built for. Matchday 1: A beats B (twice, same round). Matchday 2:
 * B and C win.
 */
function twoMatchdayFixtures(): LeagueFixture[] {
  return [
    fixture({ round: 'round-1', kickoff: '2026-08-01T18:00:00.000Z', winner: 'player-a' }),
    fixture({ round: 'round-1', kickoff: '2026-08-01T19:00:00.000Z', winner: 'player-a' }),
    fixture({ round: 'round-2', kickoff: '2026-08-08T18:00:00.000Z', winner: 'player-b' }),
    fixture({ round: 'round-2', kickoff: '2026-08-08T19:00:00.000Z', winner: 'player-c' }),
    fixture({ round: 'round-3', kickoff: '2026-08-15T18:00:00.000Z', status: 'scheduled' }),
  ];
}

// ---------------------------------------------------------------------------
// Derivation: up / down / null-first-matchday
// ---------------------------------------------------------------------------

describe('deriveRankChanges', () => {
  it('positive = climbed, negative = dropped, 0 = unmoved', () => {
    const previous = [standing('b', 6), standing('a', 3), standing('c', 3)];
    const current = [standing('a', 6), standing('b', 6), standing('c', 3)];

    expect(deriveRankChanges(current, previous)).toEqual(
      new Map([
        ['a', 1], // 2nd → 1st
        ['b', -1], // 1st → 2nd
        ['c', 0],
      ]),
    );
  });

  it('first matchday (no previous table) yields null for every row', () => {
    const current = [standing('a', 3), standing('b', 0)];
    const changes = deriveRankChanges(current, null);
    expect([...changes.values()]).toEqual([null, null]);
  });

  it('a player absent from the previous table yields null', () => {
    const previous = [standing('a', 3)];
    const current = [standing('new', 6), standing('a', 3)];
    expect(deriveRankChanges(current, previous).get('new')).toBeNull();
    // 'a' held rank 1 alone; the newcomer entering above them drops them to 2.
    expect(deriveRankChanges(current, previous).get('a')).toBe(-1);
  });
});

describe('completedMatchdays', () => {
  it('groups completed fixtures by round, kickoff-ordered, excluding unplayed rounds', () => {
    const days = completedMatchdays(twoMatchdayFixtures());

    expect(days.map((day) => day.roundId)).toEqual(['round-1', 'round-2']);
    expect(days[0]?.records).toHaveLength(2);
    // The scheduled round-3 never appears.
    expect(days.some((day) => day.roundId === 'round-3')).toBe(false);
  });

  it('the previous snapshot is every matchday before the latest one with results', () => {
    const earlier = completedMatchdays(twoMatchdayFixtures()).slice(0, -1).flatMap((d) => d.records);
    expect(earlier).toHaveLength(2);
    expect(earlier.every((record) => record.round_number === 0)).toBe(true);
  });

  it('a season with results in one matchday only has no earlier snapshot (first matchday → null)', () => {
    const days = completedMatchdays([
      fixture({ round: 'round-1', kickoff: '2026-08-01T18:00:00.000Z' }),
    ]);
    expect(days).toHaveLength(1);
    expect(days.slice(0, -1)).toHaveLength(0);
  });

  it('orders rounds by earliest kickoff, not insertion order', () => {
    const days = completedMatchdays([
      fixture({ round: 'round-late', kickoff: '2026-09-01T18:00:00.000Z' }),
      fixture({ round: 'round-early', kickoff: '2026-08-01T18:00:00.000Z' }),
    ]);
    expect(days.map((day) => day.roundId)).toEqual(['round-early', 'round-late']);
  });
});

// ---------------------------------------------------------------------------
// Preview fixtures: deterministic deltas, DB-free
// ---------------------------------------------------------------------------

describe('buildPreviewWorld standings movement', () => {
  const { standings } = buildPreviewWorld();

  it('carries a rank_change on every row once a second matchday has results', () => {
    expect(standings.every((row) => typeof row.rank_change === 'number')).toBe(true);
  });

  it('moves at least one trainer up and one down (the board shows ↑ and ↓)', () => {
    expect(standings.some((row) => (row.rank_change ?? 0) > 0)).toBe(true);
    expect(standings.some((row) => (row.rank_change ?? 0) < 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Passthrough: derived values reach the painter input (bar-hygiene law)
// ---------------------------------------------------------------------------

describe('buildBoardContent rank passthrough', () => {
  const preview = buildPreviewWorld();
  const { world: _world, ...data } = preview;

  it('threads rank_change from standings rows into BoardTableRow.rankChange', () => {
    const content = buildBoardContent(data, 'de');
    expect(content.table.map((row) => row.rankChange)).toEqual(
      data.standings.slice(0, content.table.length).map((row) => row.rank_change ?? null),
    );
    // And the preview actually moves someone on the painted board.
    expect(content.table.some((row) => row.rankChange !== null)).toBe(true);
  });

  it('rows without movement data keep rankChange null (disclosed fallback)', () => {
    const withoutMovement = {
      ...data,
      standings: data.standings.map((row) => ({ ...row, rank_change: null })),
    };
    const content = buildBoardContent(withoutMovement, 'de');
    expect(content.table.every((row) => row.rankChange === null)).toBe(true);
  });

  it('non-rank columns are unchanged by the movement data', () => {
    const withoutMovement = {
      ...data,
      standings: data.standings.map((row) => ({ ...row, rank_change: null })),
    };
    const strip = (rows: ReturnType<typeof buildBoardContent>['table']) =>
      rows.map(({ rankChange: _rc, ...rest }) => rest);
    expect(strip(buildBoardContent(data, 'de').table)).toEqual(strip(buildBoardContent(withoutMovement, 'de').table));
  });
});

// ---------------------------------------------------------------------------
// Glyph mapping + painter coordinates
// ---------------------------------------------------------------------------

describe('rankMoveGlyph / rankMoveColor', () => {
  it('maps deltas to up/down/same glyphs, null stays closed', () => {
    expect(rankMoveGlyph(null)).toBeNull();
    expect(rankMoveGlyph(0)).toEqual({ char: '–', move: 'same' });
    expect(rankMoveGlyph(1)).toEqual({ char: '↑', move: 'up' });
    expect(rankMoveGlyph(3)).toEqual({ char: '↑', move: 'up' });
    expect(rankMoveGlyph(-2)).toEqual({ char: '↓', move: 'down' });
  });

  it('colors: live up, red down, dimmed ink unmoved', () => {
    const theme: BoardTheme = { kind: 'pulse', accent: '#38bdf8', red: '#e23b3b', live: '#166534' };
    expect(rankMoveColor('up', theme, '#f4fbff')).toBe('#166534');
    expect(rankMoveColor('down', theme, '#f4fbff')).toBe('#e23b3b');
    expect(rankMoveColor('same', theme, '#f4fbff')).toBe(hexA('#f4fbff', 0.45));
  });
});

interface TextOp {
  op: 'fillText';
  text: string;
  x: number;
  y: number;
  fill: string;
  font: string;
}

/** Records every fillText with the style active at call time — painter evidence without a canvas. */
function recordingCtx() {
  const gradient = { addColorStop: () => undefined };
  const state = { fill: '#000000', font: '' };
  const textOps: TextOp[] = [];
  const ctx = {
    get fillStyle() {
      return state.fill;
    },
    set fillStyle(v: string) {
      state.fill = v;
    },
    get font() {
      return state.font;
    },
    set font(v: string) {
      state.font = v;
    },
    textAlign: 'left' as CanvasTextAlign,
    strokeStyle: '#000000',
    lineWidth: 1,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arcTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    setLineDash: () => undefined,
    createLinearGradient: () => gradient,
    measureText: (text: string) => ({ width: text.length * 12 }) as TextMetrics,
    fillText(text: string, x: number, y: number) {
      textOps.push({ op: 'fillText', text, x, y, fill: state.fill, font: state.font });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, textOps };
}

const THEME: BoardTheme = { kind: 'pulse', accent: '#38bdf8', red: '#e23b3b', live: '#166534' };
/**
 * C-105 r1: paintTableBoard gained the shared paint path's `tools` param — the
 * font floor is enforced at the Board mount (station pose-derived), not in the
 * painter, so these layout tests pass a pass-through clamp and assert the
 * painter's own geometry unchanged.
 */
const TOOLS = { fontPx: (n: number) => Math.ceil(n), fontFloorPx: 0 };
/** paintTableBoard row geometry: base = 215 + i * 42 (top 172, rowH 42), glyph column x = 100. */
const glyphCell = (row: number) => ({ x: 100, y: 215 + row * 42 });

function previewContentWithDeltas(deltas: (number | null)[]) {
  const preview = buildPreviewWorld();
  const { world: _world, ...data } = preview;
  const standings = data.standings.map((row, i) => ({
    ...row,
    rank_change: deltas[i] ?? null,
  }));
  return buildBoardContent({ ...data, standings }, 'de');
}

describe('paintTableBoard glyph painting', () => {
  it('paints ↑/↓/– beside the rank at the movement column, in the movement colours', () => {
    const content = previewContentWithDeltas([2, -1, 0, null]);
    const { ctx, textOps } = recordingCtx();
    paintTableBoard(ctx, 1024, 592, content, THEME, TOOLS);

    const cell0 = glyphCell(0);
    const up = textOps.find((op) => op.text === '↑');
    expect(up).toMatchObject({ x: cell0.x, y: cell0.y, fill: '#166534' });
    expect(up?.font).toContain('800 22px');

    const cell1 = glyphCell(1);
    const down = textOps.find((op) => op.text === '↓');
    expect(down).toMatchObject({ x: cell1.x, y: cell1.y, fill: '#e23b3b' });

    const cell2 = glyphCell(2);
    const same = textOps.find((op) => op.text === '–');
    expect(same).toMatchObject({ x: cell2.x, y: cell2.y, fill: hexA('#f4fbff', 0.45) });
  });

  it('a null row paints no glyph — rank 4 has nothing at its movement cell', () => {
    const content = previewContentWithDeltas([2, -1, 0, null]);
    const { ctx, textOps } = recordingCtx();
    paintTableBoard(ctx, 1024, 592, content, THEME, TOOLS);

    const cell3 = glyphCell(3);
    expect(textOps.filter((op) => op.x === cell3.x && op.y === cell3.y)).toHaveLength(0);
  });

  it('keeps the column closed and the old name position without movement data', () => {
    const preview = buildPreviewWorld();
    const { world: _world, ...data } = preview;
    const content = buildBoardContent({
      ...data,
      standings: data.standings.map((row) => ({ ...row, rank_change: null })),
    }, 'de');
    const { ctx, textOps } = recordingCtx();
    paintTableBoard(ctx, 1024, 592, content, THEME, TOOLS);

    expect(textOps.some((op) => ['↑', '↓', '–'].includes(op.text))).toBe(false);
    // The `moved=false` layout the passed PULS board was judged on: names at 112.
    expect(textOps.some((op) => op.x === 112)).toBe(true);
  });

  it('non-rank content is byte-class comparable with and without movement data', () => {
    const withMovement = previewContentWithDeltas([2, -1, 0, null]);
    const preview = buildPreviewWorld();
    const { world: _world, ...data } = preview;
    const without = buildBoardContent({
      ...data,
      standings: data.standings.map((row) => ({ ...row, rank_change: null })),
    }, 'de');

    const painted = (content: ReturnType<typeof buildBoardContent>) => {
      const { ctx, textOps } = recordingCtx();
      paintTableBoard(ctx, 1024, 592, content, THEME, TOOLS);
      // Drop the three coordinates the movement column legitimately touches:
      // the glyph cell (x=100) and the two name-column positions (112/136).
      return textOps.filter((op) => op.x !== 100 && op.x !== 112 && op.x !== 136);
    };

    expect(painted(withMovement)).toEqual(painted(without));
  });
});
