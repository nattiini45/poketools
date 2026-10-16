/**
 * C4: the named scenario axis of the route-preview fixtures.
 *
 * `PreviewScenario` is orthogonal to the epb/open format variant, so every
 * assertion here pins one scenario's data contract (the shapes the C3
 * empty-state painters and the board content derivation key off) plus the
 * backward compatibility of the pre-C4 one-arg/two-arg call sites.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPreviewRoute,
  buildPreviewSakuraWorld,
  buildPreviewMountainWorld,
  buildPreviewCloudsWorld,
  isPreviewScenario,
  PREVIEW_SCENARIOS,
} from '../fixtures';
import { buildBoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { EvoligaRouteData } from '@/components/world/evoliga/route/route-data';
import { deriveRosterTiles } from '@/lib/worlds/route-data';
import type { WorldRouteData } from '@/lib/worlds/route-data';

/**
 * The board content builder reads the evoliga view of the contract; the
 * preview fixtures always carry a league row, so the adapter mapping is
 * inlined here (the real adapter lives in a 'use client' module).
 */
function toBoardData(data: WorldRouteData): EvoligaRouteData {
  if (!data.league) throw new Error('preview fixtures always carry a league row');
  return {
    league: data.league,
    stages: data.stages,
    participants: data.participants,
    entries: data.rosterLines ?? [],
    trackers: data.trackers,
    standings: data.standings,
    fixtures: data.fixtures,
    formatRules: data.formatRules,
    hasDraftPool: data.hasDraftPool,
  };
}

describe('scenario axis — empty', () => {
  it('sakura epb: no fixtures, no standings, roster tiles still painted', () => {
    const { data } = buildPreviewSakuraWorld('epb', 'empty');
    expect(data.fixtures).toEqual([]);
    expect(data.standings).toEqual([]);
    expect(data.rosterLines?.length ?? 0).toBeGreaterThan(0);
    expect(deriveRosterTiles(data).length).toBeGreaterThan(0);
    expect(data.trackers.length).toBeGreaterThan(0);
    expect(data.formatRules).not.toBeNull();

    const content = buildBoardContent(toBoardData(data), 'en');
    expect(content.table).toHaveLength(0);
    expect(content.results).toHaveLength(0);
    expect(content.upcoming).toHaveLength(0);
  });

  it('mountain open: participant-derived roster survives the empty schedule', () => {
    const { data } = buildPreviewMountainWorld('open', 'empty');
    expect(data.fixtures).toEqual([]);
    expect(data.standings).toEqual([]);
    expect(data.rosterLines).toBeNull();
    const tiles = deriveRosterTiles(data);
    expect(tiles).toHaveLength(data.participants.length);
    expect(tiles.length).toBeGreaterThan(0);

    const content = buildBoardContent(toBoardData(data), 'en');
    expect(content.table).toHaveLength(0);
    expect(content.results).toHaveLength(0);
    expect(content.upcoming).toHaveLength(0);
  });
});

describe('scenario axis — disputed', () => {
  it('sakura: exactly one disputed fixture and no live match on the board', () => {
    const { data } = buildPreviewSakuraWorld('epb', 'disputed');
    const disputed = data.fixtures.filter((f) => f.match.status === 'disputed');
    expect(disputed).toHaveLength(1);
    expect(disputed[0].match.date_played).not.toBeNull();
    expect(data.fixtures.some((f) => f.match.status === 'in_progress')).toBe(false);
    expect(buildBoardContent(toBoardData(data), 'en').live).toBeNull();
  });

  it('clouds: same single-dispute shape, and the baseline is untouched', () => {
    const { data } = buildPreviewCloudsWorld('epb', 'disputed');
    expect(data.fixtures.filter((f) => f.match.status === 'disputed')).toHaveLength(1);
    expect(buildBoardContent(toBoardData(data), 'en').live).toBeNull();

    // The baseline still carries its live match — the flip is per-call, not shared state.
    const baseline = buildPreviewCloudsWorld('epb').data;
    expect(baseline.fixtures.filter((f) => f.match.status === 'disputed')).toHaveLength(0);
    expect(baseline.fixtures.some((f) => f.match.status === 'in_progress')).toBe(true);
  });
});

describe('scenario axis — archive', () => {
  it('sakura: every fixture completed with a date, every stage closed', () => {
    const { data } = buildPreviewSakuraWorld('epb', 'archive');
    expect(data.fixtures.length).toBeGreaterThan(0);
    for (const fixture of data.fixtures) {
      expect(fixture.match.status).toBe('completed');
      expect(fixture.match.date_played).toBeTruthy();
      expect(['in_progress', 'scheduled']).not.toContain(fixture.match.status);
    }
    expect(data.stages.length).toBeGreaterThan(0);
    for (const stage of data.stages) {
      expect(stage.status).toBe('completed');
    }
    expect(buildBoardContent(toBoardData(data), 'en').live).toBeNull();
  });

  it('mountain open: archived season keeps the participant roster path', () => {
    const { data } = buildPreviewMountainWorld('open', 'archive');
    expect(data.fixtures.every((f) => f.match.status === 'completed')).toBe(true);
    expect(data.stages.every((s) => s.status === 'completed')).toBe(true);
    expect(deriveRosterTiles(data)).toHaveLength(data.participants.length);
  });
});

describe('scenario axis — long-names', () => {
  it('sakura: long display names, stable ids', () => {
    const baseline = buildPreviewSakuraWorld('epb').data;
    const { data } = buildPreviewSakuraWorld('epb', 'long-names');

    expect(data.participants.some((p) => p.name.length > 25)).toBe(true);
    expect(data.participants.every((p) => p.name.length > 20)).toBe(true);
    expect(data.participants.map((p) => p.id)).toEqual(baseline.participants.map((p) => p.id));
    expect(data.fixtures.map((f) => f.match.id)).toEqual(baseline.fixtures.map((f) => f.match.id));
    expect(data.fixtures.some((f) => f.match.player_1_name.length > 25)).toBe(true);
    expect(data.standings.some((row) => row.player_name.length > 25)).toBe(true);
  });

  it('mountain open: long names flow into the participant-derived tiles', () => {
    const { data } = buildPreviewMountainWorld('open', 'long-names');
    expect(data.participants.some((p) => p.name.length > 25)).toBe(true);
    // Tiles fall back to participant names where a team ace exists they show
    // the species — either way the roster is painted, ids stable.
    expect(deriveRosterTiles(data)).toHaveLength(data.participants.length);
  });
});

describe('scenario axis — large', () => {
  it('sakura: more fixtures and more drafted roster lines than baseline', () => {
    const baseline = buildPreviewSakuraWorld('epb').data;
    const { data } = buildPreviewSakuraWorld('epb', 'large');

    expect(data.fixtures.length).toBeGreaterThan(baseline.fixtures.length);
    expect(data.trackers.length).toBeGreaterThan(baseline.trackers.length);
    // Full roster: every list line is present, and the large draft covers it entirely.
    expect(data.rosterLines?.length).toBe(baseline.rosterLines?.length);
    expect(data.trackers.length).toBe(data.rosterLines?.length);
    // Doubled matchdays stay valid ISO kickoffs.
    for (const fixture of data.fixtures) {
      expect(Number.isNaN(Date.parse(fixture.match.scheduled_at ?? ''))).toBe(false);
    }
  });

  it('clouds: fixture count doubles against the baseline', () => {
    const baseline = buildPreviewCloudsWorld('epb').data;
    const { data } = buildPreviewCloudsWorld('epb', 'large');
    expect(data.fixtures.length).toBeGreaterThan(baseline.fixtures.length);
  });
});

describe('Bo3 fixture consistency', () => {
  /**
   * A decided Bo3 must not contradict its own game list: the match winner
   * takes exactly two games (2-0 sweep or 2-1), never a 1-1 "sweep". Covers
   * both the baseline `buildFixtures` deal and the `archiveFixtures` re-deal.
   */
  function expectWinnerTakesTwo(fixtures: WorldRouteData['fixtures'], label: string): void {
    const decided = fixtures.filter((f) => f.match.winner_id !== null);
    expect(decided.length, `${label}: expected decided matches`).toBeGreaterThan(0);
    for (const { match } of decided) {
      expect([2, 3], `${label}: ${match.id} series length`).toContain(match.games.length);
      const wins = match.games.filter((g) => g.winner_id === match.winner_id).length;
      expect(wins, `${label}: ${match.id} winner's game tally`).toBe(2);
    }
  }

  it('plaza baseline: completed matches agree with their game tallies', () => {
    expectWinnerTakesTwo(buildPreviewRoute().fixtures, 'plaza baseline');
  });

  it('themed populated: the same deal flows through buildScenarioRows', () => {
    expectWinnerTakesTwo(buildPreviewSakuraWorld('epb', 'populated').data.fixtures, 'sakura populated');
  });

  it('archive: every match is decided and archiveFixtures deals consistent games', () => {
    const { data } = buildPreviewSakuraWorld('epb', 'archive');
    expect(data.fixtures.every((f) => f.match.status === 'completed')).toBe(true);
    expectWinnerTakesTwo(data.fixtures, 'sakura archive');
  });
});

describe('scenario axis — defaults', () => {
  it('sakura and clouds: formatRules is null, data otherwise populated', () => {
    for (const built of [
      buildPreviewSakuraWorld('epb', 'defaults'),
      buildPreviewCloudsWorld('epb', 'defaults'),
    ]) {
      expect(built.data.formatRules).toBeNull();
      expect(built.data.fixtures.length).toBeGreaterThan(0);
      expect(built.data.standings.length).toBeGreaterThan(0);
    }
  });
});

describe('backward compatibility', () => {
  it("one-arg 'open' still builds the non-EPB participant-tile path", () => {
    const { data } = buildPreviewSakuraWorld('open');
    expect(data.hasDraftPool).toBe(false);
    expect(data.rosterLines).toBeNull();
    const tiles = deriveRosterTiles(data);
    expect(tiles).toHaveLength(data.participants.length);
    expect(tiles.every((tile) => tile.price === null)).toBe(true);
    // Team aces drive the tile names where team data exists.
    expect(Object.keys(data.teamAces).length).toBe(data.participants.length);
  });

  it('no-arg call equals (epb, populated) structurally', () => {
    expect(JSON.stringify(buildPreviewSakuraWorld())).toEqual(
      JSON.stringify(buildPreviewSakuraWorld('epb', 'populated')),
    );
    expect(JSON.stringify(buildPreviewMountainWorld('open'))).toEqual(
      JSON.stringify(buildPreviewMountainWorld('open', 'populated')),
    );
  });

  it('baseline keeps its live match and completed results', () => {
    const { data } = buildPreviewSakuraWorld('epb', 'populated');
    const content = buildBoardContent(toBoardData(data), 'en');
    expect(content.live).not.toBeNull();
    expect(content.table.length).toBeGreaterThan(0);
    expect(content.results.length).toBeGreaterThan(0);
    expect(data.formatRules).not.toBeNull();
  });

  it('scenario guard validates exactly the documented union', () => {
    for (const scenario of PREVIEW_SCENARIOS) {
      expect(isPreviewScenario(scenario)).toBe(true);
    }
    expect(isPreviewScenario('open')).toBe(false);
    expect(isPreviewScenario('bogus')).toBe(false);
    expect(isPreviewScenario(undefined)).toBe(false);
  });
});
