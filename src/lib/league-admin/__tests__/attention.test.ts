import { describe, expect, it } from 'vitest';
import { leagueAttention, type LeagueAttentionInput } from '../attention';

const ID = '5e150000-0000-4000-8000-000000000001';

function league(overrides: Partial<LeagueAttentionInput> = {}): LeagueAttentionInput {
  return {
    id: ID,
    status: 'upcoming',
    archived: false,
    format_type: 'singles',
    participant_count: 8,
    tournament_count: 1,
    ruleset_id: 'rs-1',
    start_date: '2026-09-01',
    ...overrides,
  };
}

describe('leagueAttention', () => {
  it('a league that has everything needs nothing', () => {
    expect(leagueAttention(league())).toEqual([]);
    expect(leagueAttention(league({ status: 'active' }))).toEqual([]);
  });

  it('lists what is missing, each with the tab that fixes it', () => {
    expect(leagueAttention(league({ participant_count: 0, tournament_count: 0, ruleset_id: null, start_date: null }))).toEqual([
      { id: 'noParticipants', href: `/admin/leagues/${ID}?tab=participants` },
      { id: 'noPhases', href: `/admin/leagues/${ID}?tab=phases` },
      { id: 'noRuleset', href: `/admin/leagues/${ID}?tab=settings` },
      { id: 'noStartDate', href: `/admin/leagues/${ID}?tab=settings` },
    ]);
  });

  it('a custom league lists no set-up items: its readiness checklist does', () => {
    expect(leagueAttention(league({ format_type: 'custom', participant_count: 0, tournament_count: 0, ruleset_id: null, start_date: null }))).toEqual([]);
  });

  it('a completed league lists no set-up items', () => {
    expect(leagueAttention(league({ status: 'completed', participant_count: 0, start_date: null }))).toEqual([]);
  });

  it('an archived league says so, linked to the danger zone, and lists nothing else', () => {
    expect(leagueAttention(league({ archived: true, participant_count: 0 }))).toEqual([
      { id: 'archived', href: `/admin/leagues/${ID}?tab=settings#danger-zone` },
    ]);
  });
});
