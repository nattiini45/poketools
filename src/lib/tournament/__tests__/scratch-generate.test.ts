import { beforeEach, describe, it, vi } from 'vitest';

// Capture what materializeReadySlots creates.
const createdMatches: Array<{
  player_1_id: string;
  player_2_id: string;
  bracket_side: string;
  bracket_pos: number;
  round_id: string;
}> = [];
const createdRounds: Array<{ round_number: number; name: string; bracket_side: string }> = [];

vi.mock('@/lib/supabase/queries/rounds', () => ({
  createRound: vi.fn(async (input: { round_number: number; name: string; bracket_side: string }) => {
    createdRounds.push(input);
    return {
      id: `round-${input.round_number}`,
      tournament_id: 't1',
      name: input.name,
      round_number: input.round_number,
      best_of: 3,
      status: 'pending',
      pairings_generated: true,
      deadline: null,
      bracket_side: input.bracket_side,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
  }),
  getRoundsByTournament: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByTournament: vi.fn(async () => []),
  getMatchById: vi.fn(),
  createMatchBatch: vi.fn(async (rows: Array<{
    player_1_id: string;
    player_2_id: string;
    bracket_side: string;
    bracket_pos: number;
    round_id: string;
  }>) => {
    createdMatches.push(...rows.map((r) => ({
      player_1_id: r.player_1_id,
      player_2_id: r.player_2_id,
      bracket_side: r.bracket_side,
      bracket_pos: r.bracket_pos,
      round_id: r.round_id,
    })));
    return rows.map((r, i) => ({ id: `m${i}`, ...r }));
  }),
  updateMatchPlayers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getGamesByMatch: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  freezeEnrollment: vi.fn(),
  updateTournament: vi.fn(),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  resetMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: vi.fn(() => ({ delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })), in: vi.fn(async () => ({ error: null })) })) })) },
}));

import { generateEliminationBracket } from '../bracket-generate';
import type { ParticipantWithSeed, Tournament } from '@/types/tournament';

function makeTournament(): Tournament {
  return {
    id: 't1',
    name: 'Test Cup',
    description: '',
    season_id: null,
    bracket_type: 'double_elim',
    ruleset_id: 'ruleset-1',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: 'active',
    current_round: 1,
    stage_order: 1,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeParticipants(n: number, lbIds: string[]): ParticipantWithSeed[] {
  const lb = new Set(lbIds);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    seed: i + 1,
    starting_bracket: lb.has(`p${i + 1}`) ? 'losers' : 'winners',
    discord_id: null,
    auth_user_id: null,
    ps_username: '',
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: null,
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));
}

describe('generate LB materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdMatches.length = 0;
    createdRounds.length = 0;
  });

  it('materializes LB starters? (8 players, p7+p8 in losers)', async () => {
    await generateEliminationBracket(makeTournament(), makeParticipants(8, ['p7', 'p8']));
    console.log('ROUNDS:', JSON.stringify(createdRounds));
    console.log('MATCHES:', JSON.stringify(createdMatches, null, 2));
    const lbMatches = createdMatches.filter((m) => m.bracket_side === 'losers');
    console.log('LB MATCH COUNT:', lbMatches.length);
  });
});
