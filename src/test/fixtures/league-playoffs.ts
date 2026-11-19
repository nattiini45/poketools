import type { MatchWithRoundNumber } from '@/types/match';
import type { LeagueScheduleInput } from '@/lib/supabase/queries/league-standings';

function match(stage: string, round: number, a: string, b: string, winner: string): MatchWithRoundNumber {
  return {
    id: `${stage}-${round}-${a}`, tournament_id: stage, round_id: `${stage}-${round}`,
    round_number: round, player_1_id: a, player_2_id: b, winner_id: winner,
    status: 'completed', bracket_side: stage === 'playoffs' ? 'winners' : null, bracket_pos: 0,
    player_1_name: a, player_2_name: b, winner_name: winner,
    player_1_avatar_url: null, player_2_avatar_url: null, games: [], round_status: 'completed',
    date_played: null, scheduled_at: `2026-09-0${round}T18:00:00Z`,
    created_at: '', updated_at: '', submitter_id: null, auto_confirm_at: null, confirmed_at: null,
    notes: '', social_image_url: null,
  };
}

export function leaguePlayoffsFixture(playoffs = true) {
  return {
    stages: [{ id: 'groups', name: 'Groups', bracket_type: 'round_robin' },
      ...(playoffs ? [{ id: 'playoffs', name: 'Playoffs', bracket_type: 'single_elim' as const, participant_count: 4 }] : [])],
    participants: ['Comet', 'Meteor', 'Nova', 'Orbit', 'Pulsar', 'Quasar'].map((id) => ({ id, name: id, avatar_url: null })),
    context: { formatType: 'singles' },
    groups: [{ id: 'gold', name: 'Gold', sort_order: 1, player_ids: ['Comet', 'Meteor', 'Pulsar'] },
      { id: 'silver', name: 'Silver', sort_order: 2, player_ids: ['Nova', 'Orbit', 'Quasar'] }],
    matchesByStage: new Map([
      ['groups', [match('groups', 1, 'Comet', 'Meteor', 'Comet'), match('groups', 1, 'Nova', 'Orbit', 'Nova'),
        match('groups', 1, 'Pulsar', 'Quasar', 'Pulsar'), match('groups', 2, 'Comet', 'Nova', 'Comet'),
        match('groups', 2, 'Meteor', 'Orbit', 'Meteor')]],
      ['playoffs', [match('playoffs', 1, 'Comet', 'Orbit', 'Orbit'),
        { ...match('playoffs', 1, 'Meteor', 'Nova', 'Nova'), bracket_pos: 1 }, match('playoffs', 2, 'Orbit', 'Nova', 'Orbit')]],
    ]),
  } satisfies LeagueScheduleInput;
}
