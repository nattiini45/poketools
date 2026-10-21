/**
 * C-055: `rank_change` is a first-class field of the world data contracts.
 *
 * The plaza boards read rank movement straight off the standings rows the page
 * hands down — `EvoligaWorldData.standings` / `EvoligaRouteData.standings` are
 * `LeagueStanding[]`, and `LeagueStanding.rank_change` is required. The
 * `expectTypeOf` blocks below are enforced by `tsc --noEmit` (vitest itself
 * does not typecheck): they fail the moment the boundary regresses to the bare
 * `Standing[]`, to a bare intersection (PB-212 — the override never reaches
 * the element type), or back to an optional consumer-side shim field.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EvoligaWorldData } from '@/components/world/evoliga/types';
import type { EvoligaRouteData } from '@/components/world/evoliga/route/route-data';
import type { LeagueStanding } from '@/lib/supabase/queries/league-standings';
import { buildBoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import { buildPreviewWorld } from '@/app/(public)/route-preview/fixtures';

describe('rank_change provider contract (types)', () => {
  it('EvoligaWorldData.standings is exactly LeagueStanding[] (Omit & override, not an intersection)', () => {
    expectTypeOf<EvoligaWorldData['standings']>().toEqualTypeOf<LeagueStanding[]>();
  });

  it('EvoligaRouteData.standings keeps the sharpened field through the Omit', () => {
    expectTypeOf<EvoligaRouteData['standings']>().toEqualTypeOf<LeagueStanding[]>();
  });

  it('rank_change is required and nullable — present on every row, null when unknown', () => {
    expectTypeOf<LeagueStanding['rank_change']>().toEqualTypeOf<number | null>();
  });

  it('the preview payload satisfies the world contract as-is', () => {
    expectTypeOf(buildPreviewWorld()).toExtend<EvoligaWorldData>();
  });
});

describe('rank_change provider contract (runtime)', () => {
  it('buildBoardContent threads the contract field 1:1 into BoardTableRow.rankChange', () => {
    const { world: _world, ...data } = buildPreviewWorld();
    const standings = data.standings.map((row, i) => ({
      ...row,
      rank_change: [3, -2, 0, null][i] ?? null,
    }));
    const content = buildBoardContent({ ...data, standings }, 'de');

    expect(content.table.map((row) => row.rankChange)).toEqual(
      content.table.map((_, i) => [3, -2, 0, null][i] ?? null),
    );
  });

  it('a null rank_change (first matchday) keeps every glyph column value null', () => {
    const { world: _world, ...data } = buildPreviewWorld();
    const standings = data.standings.map((row) => ({ ...row, rank_change: null }));
    const content = buildBoardContent({ ...data, standings }, 'de');

    expect(content.table.every((row) => row.rankChange === null)).toBe(true);
  });
});
