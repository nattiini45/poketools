import type { PhaseTeam } from '@/types/phase-team';

export function phaseTeam(overrides: Partial<PhaseTeam> = {}): PhaseTeam {
  return {
    id: '11111111-1111-4111-8111-111111111111', phase_id: '22222222-2222-4222-8222-222222222222',
    player_id: 'owner', season_id: 'season', name: '', match_id: null, pokemon: [], import_source: 'manual',
    locked: false, is_draft_team: false, draft_pool_id: null, library_published_at: null, library_title: null,
    library_description: null, library_tags: null, forked_from_team_id: null, forked_from_phase_team_id: null,
    created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z', ...overrides,
  };
}
