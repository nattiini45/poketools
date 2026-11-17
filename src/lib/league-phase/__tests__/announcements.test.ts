import { beforeEach, describe, expect, it, vi } from 'vitest';
import { leaguePlayoffsFixture } from '@/test/fixtures/league-playoffs';
import type { Phase } from '@/types/league-phase';
import type { PhaseFinalizationEffects } from '../finalization';

const h = vi.hoisted(() => ({ discord: vi.fn(), social: vi.fn(), phase: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitPhaseDiscordEvent: h.discord }));
vi.mock('@/lib/social/notify', () => ({ emitPhaseSocialEvent: h.social }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: h.phase }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: h.audit }));

import { announcePhaseMatchCompletion, announcePhaseMatchDispute, announceNativeKitStageCompletion } from '../announcements';

const phase: Phase = { id: 'phase', season_id: 'league', name: 'Synthetic phase', description: '',
  bracket_type: 'round_robin', ruleset_id: 'version', best_of_default: 1, bo_overrides: {}, is_doubles: false,
  team_visibility: 'hidden_until_match', status: 'completed', current_round: 2, stage_order: 1,
  advancement_rule: null, enrollment_source: null, archived: false, legacy: false, bracket_reset_enabled: false,
  third_place_enabled: false, format_stage_key: null, format_group: 0, stage_spec: null, created_at: '', updated_at: '' };

function input(): Parameters<PhaseFinalizationEffects['announcements']>[0] {
  const fixture = leaguePlayoffsFixture().matchesByStage.get('groups')?.[0];
  if (!fixture) throw new Error('Synthetic match fixture missing');
  const { tournament_id: _legacyOwner, ...fields } = fixture;
  return { match: { ...fields, phase_id: phase.id, notes: 'private notes', submitter_id: 'private submitter',
    social_image_url: 'https://example.invalid/card.png', games: [
      { id: 'later', game_number: 2, winner_id: fields.player_1_id, replay_url: 'https://example.invalid/later', source: 'manual', stats_locked: false },
      { id: 'first', game_number: 1, winner_id: fields.player_1_id, replay_url: 'https://example.invalid/first', source: 'manual', stats_locked: false },
    ] }, winnerId: fields.player_1_id, competition: phase, statsByGame: {},
    ratingChanges: null, streaks: null, achievements: null };
}

beforeEach(() => { vi.resetAllMocks(); h.phase.mockResolvedValue(phase); });

describe('concrete phase announcement effects', () => {
  it('emits explicit native ownership and public fields without mutating the source match', () => {
    const facts = input(); const before = structuredClone(facts);
    announcePhaseMatchCompletion(facts);
    expect(facts).toEqual(before);
    expect(h.discord).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ version: 1,
      owner: { kind: 'phase', phase_id: 'phase', season_id: 'league' }, event_type: 'match_confirmed',
      data: expect.objectContaining({ phase_name: phase.name, replay_url: 'https://example.invalid/first' }) }));
    expect(h.social).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: 'https://example.invalid/card.png' }));
    const output = JSON.stringify(h.discord.mock.calls);
    expect(output).not.toContain('tournament_id'); expect(output).not.toContain('tournament_name');
    expect(output).not.toContain('private notes'); expect(output).not.toContain('private submitter');
  });

  it('refuses foreign phase ownership before sending', () => {
    const facts = input(); facts.match.phase_id = 'foreign';
    expect(() => announcePhaseMatchCompletion(facts)).toThrow('scope mismatch');
    expect(h.discord).not.toHaveBeenCalled(); expect(h.social).not.toHaveBeenCalled();
  });

  it('uses the actual phase for a dispute and propagates a failed owner lookup', async () => {
    const facts = input();
    const player = { playerId: facts.match.player_1_id, name: 'Comet', isAdmin: false, isResourceAdmin: false,
      isCreator: false, psUsername: 'synthetic', championsUsername: 'synthetic', avatarUrl: null, status: 'active' as const };
    await announcePhaseMatchDispute({ match: facts.match, player });
    expect(h.phase).toHaveBeenCalledWith('phase');
    expect(h.discord).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'match_disputed',
      owner: { kind: 'phase', phase_id: 'phase', season_id: 'league' }, data: expect.objectContaining({ disputer_name: 'Comet' }) }));
    const error = new Error('Native phase read unavailable'); h.phase.mockRejectedValue(error);
    await expect(announcePhaseMatchDispute({ match: facts.match, player })).rejects.toBe(error);
  });

  it('announces a committed automatic completion once and audits a held-advance retry without repeating it', async () => {
    const reaction = { applied: true, held: false, advance: { ran: true,
      results: [{ target_phase_id: 'next', enrolled_count: 2 }], error: null } };
    await announceNativeKitStageCompletion({ phase, reason: 'end_when:main', retry: false, reaction });
    expect(h.discord).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event_type: 'phase_completed' }));
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'phase.update', resource_type: 'phase',
      changes: { status: { before: 'active', after: 'completed' } }, metadata: expect.objectContaining({ auto_advanced: 1 }) }));
    await announceNativeKitStageCompletion({ phase, reason: 'end_when:main', retry: true, reaction });
    expect(h.discord).toHaveBeenCalledTimes(1); expect(h.social).toHaveBeenCalledTimes(1);
    expect(h.audit.mock.calls[1][0]).toMatchObject({ metadata: { via: 'stage_end_retry', auto_advanced: 1 } });
    expect(h.audit.mock.calls[1][0]).not.toHaveProperty('changes');
  });
});
