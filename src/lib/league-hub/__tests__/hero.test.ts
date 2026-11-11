import { describe, expect, it } from 'vitest';
import { buildLeagueHero } from '@/lib/league-hub/hero';
import type { LeagueFixture, LeagueStanding } from '@/lib/supabase/queries/league-standings';

const NOW = Date.parse('2026-10-10T12:00:00Z');

function fixture(id: string, one: string, two: string, over: Partial<LeagueFixture['match']> = {}): LeagueFixture {
  return {
    stageId: 'stage-1',
    stageName: 'Regular season',
    match: {
      id,
      tournament_id: 'stage-1',
      player_1_id: one,
      player_1_name: one.toUpperCase(),
      player_1_avatar_url: null,
      player_2_id: two,
      player_2_name: two.toUpperCase(),
      player_2_avatar_url: null,
      status: 'scheduled',
      scheduled_at: null,
      round_status: 'active',
      ...over,
    } as LeagueFixture['match'],
  };
}

const standing = (playerId: string, points: number) =>
  ({ player_id: playerId, player_name: playerId.toUpperCase(), player_avatar_url: null, points }) as LeagueStanding;

const base = {
  league: { status: 'active' as const, start_date: '2026-10-01', end_date: '2026-10-31' },
  stages: [{ status: 'active' as const, current_round: 3 }],
  standings: [standing('aria', 6), standing('bram', 3), standing('cleo', 0)],
  teamAces: { aria: 'Garchomp' },
  now: NOW,
};

describe('buildLeagueHero', () => {
  it('prefers the viewer\'s own open match and puts the viewer on the home side', () => {
    const view = buildLeagueHero({
      ...base,
      viewerId: 'bram',
      fixtures: [
        fixture('live', 'aria', 'cleo', { status: 'in_progress' }),
        fixture('mine', 'cleo', 'bram', { scheduled_at: '2026-10-12T18:00:00Z' }),
      ],
    });
    expect(view.match).toMatchObject({ kind: 'yours', matchId: 'mine', canSubmit: true });
    expect(view.match?.home).toMatchObject({ playerId: 'bram', rank: 2, points: 3 });
    expect(view.match?.away.playerId).toBe('cleo');
    expect(view.leader).toBeNull();
  });

  it('does not offer Submit while the round has not started or the result waits for confirmation', () => {
    const pending = buildLeagueHero({ ...base, viewerId: 'aria', fixtures: [fixture('m', 'aria', 'bram', { round_status: 'pending' })] });
    expect(pending.match).toMatchObject({ kind: 'yours', canSubmit: false });
    const waiting = buildLeagueHero({ ...base, viewerId: 'aria', fixtures: [fixture('m', 'aria', 'bram', { status: 'pending_confirmation' })] });
    expect(waiting.match).toMatchObject({ kind: 'yours', canSubmit: false });
  });

  it('a started round comes before a pending one among the viewer\'s matches', () => {
    const view = buildLeagueHero({
      ...base,
      viewerId: 'aria',
      fixtures: [fixture('later', 'aria', 'cleo', { round_status: 'pending' }), fixture('now', 'bram', 'aria')],
    });
    expect(view.match?.matchId).toBe('now');
  });

  it('a visitor sees the live match, else the next kickoff', () => {
    const fixtures = [
      fixture('unscheduled', 'aria', 'bram'),
      fixture('late', 'aria', 'cleo', { scheduled_at: '2026-10-20T18:00:00Z' }),
      fixture('soon', 'bram', 'cleo', { scheduled_at: '2026-10-11T18:00:00Z' }),
    ];
    expect(buildLeagueHero({ ...base, viewerId: null, fixtures }).match).toMatchObject({ kind: 'next', matchId: 'soon', canSubmit: false });
    const live = buildLeagueHero({ ...base, viewerId: null, fixtures: [...fixtures, fixture('live', 'aria', 'cleo', { status: 'in_progress' })] });
    expect(live.match).toMatchObject({ kind: 'live', matchId: 'live' });
    expect(live.match?.home).toMatchObject({ playerId: 'aria', ace: 'Garchomp', rank: 1 });
  });

  it('without an open match the leader shows once a match has been played', () => {
    const played = buildLeagueHero({ ...base, viewerId: null, fixtures: [fixture('done', 'aria', 'bram', { status: 'completed' })] });
    expect(played.match).toBeNull();
    expect(played.matchesPlayed).toBe(1);
    expect(played.leader).toMatchObject({ playerId: 'aria', rank: 1, points: 6 });
    expect(buildLeagueHero({ ...base, viewerId: null, fixtures: [] }).leader).toBeNull();
  });

  it('counts the matchday and the days from the league\'s dates', () => {
    const active = buildLeagueHero({ ...base, viewerId: null, fixtures: [] });
    expect(active).toMatchObject({ matchday: 3, daysLeft: 21, startsInDays: null });
    const past = buildLeagueHero({ ...base, league: { ...base.league, end_date: '2026-10-05' }, viewerId: null, fixtures: [] });
    expect(past.daysLeft).toBeNull();
    const upcoming = buildLeagueHero({
      ...base,
      league: { status: 'upcoming', start_date: '2026-10-15', end_date: null },
      stages: [{ status: 'upcoming', current_round: 0 }],
      viewerId: null,
      fixtures: [],
    });
    expect(upcoming).toMatchObject({ matchday: null, daysLeft: null, startsInDays: 5 });
    const started = buildLeagueHero({ ...base, league: { status: 'upcoming', start_date: '2026-10-01', end_date: null }, viewerId: null, fixtures: [] });
    expect(started.startsInDays).toBeNull();
  });
});
