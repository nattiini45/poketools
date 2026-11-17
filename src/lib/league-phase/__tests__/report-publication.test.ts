import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PhaseReport } from '@/types/phase-report';

const h = vi.hoisted(() => ({ phase: vi.fn(), round: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: h.phase }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: h.round }));
vi.mock('@/lib/discord/notify', () => ({ emitPhaseDiscordEvent: h.emit }));
import { createPhaseReportPublisher } from '../report-publication';

const invalidate = vi.fn();
function report(): PhaseReport {
  return { id: 'report', phase_id: 'phase', round_id: 'round', report_type: 'round_recap', model_id: 'private model',
    content: { headline: 'Synthetic recap', narrative: '', match_summaries: [], match_data: [], pokemon_types: {},
      standings_story: '', meta_trends: 'Synthetic trends', player_spotlight: { player_id: 'one', player_name: 'Aster', reason: 'Synthetic play' }, spicy_pick: null },
    status: 'completed', prompt_tokens: 5, completion_tokens: 10, generation_time_ms: 100, error: 'private diagnostics',
    created_at: '', updated_at: '' };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('NEXTAUTH_URL', 'https://example.invalid');
  h.phase.mockResolvedValue({ id: 'phase', season_id: 'league', name: 'Synthetic phase' });
  h.round.mockResolvedValue({ id: 'round', phase_id: 'phase', name: 'Round 2' });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('native report publication', () => {
  it('expires the actual phase before sending a public recap with the approved canonical phase link', async () => {
    await createPhaseReportPublisher(invalidate)(report());
    expect(invalidate).toHaveBeenCalledExactlyOnceWith('league', ['phase']);
    expect(h.emit).toHaveBeenCalledExactlyOnceWith({ version: 1, owner: { kind: 'phase', phase_id: 'phase', season_id: 'league' },
      event_type: 'round_recap_published', data: { kind: 'round_recap_published', phase_name: 'Synthetic phase', round_name: 'Round 2',
        headline: 'Synthetic recap', match_summaries: [], meta_trends: 'Synthetic trends',
        player_spotlight: { player_name: 'Aster', reason: 'Synthetic play' }, phase_url: 'https://example.invalid/leagues/league/phases/phase' } });
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(h.emit.mock.invocationCallOrder[0]);
    const serialized = JSON.stringify(h.emit.mock.calls);
    expect(serialized).not.toContain('private'); expect(serialized).not.toContain('tournament');
    expect(serialized).not.toContain('prompt_tokens');
  });

  it('maps only forecast publication fields', async () => {
    const item = report(); item.report_type = 'round_forecast';
    item.content = { headline: 'Synthetic forecast', narrative: '', matchup_previews: [
      { player_1_name: 'Aster', player_2_name: 'Briar', storyline: 'Synthetic matchup', edge: 'internal', key_pokemon: 'Pikachu' },
    ], standings_context: '', players_to_watch: [], bold_prediction: 'Synthetic prediction' };
    await createPhaseReportPublisher(invalidate)(item);
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'round_forecast_published', data: expect.objectContaining({
      matchup_previews: [{ players: 'Aster vs Briar', storyline: 'Synthetic matchup' }], bold_prediction: 'Synthetic prediction',
    }) }));
    expect(JSON.stringify(h.emit.mock.calls)).not.toContain('key_pokemon');
  });

  it('rejects a missing/mismatched native round without invalidating or sending', async () => {
    h.round.mockResolvedValue({ id: 'round', phase_id: 'other' });
    await expect(createPhaseReportPublisher(invalidate)(report())).rejects.toThrow('scope mismatch');
    expect(invalidate).not.toHaveBeenCalled(); expect(h.emit).not.toHaveBeenCalled();
  });

  it('does not publish incomplete or inconsistent report content', async () => {
    const item = report(); item.status = 'pending';
    await expect(createPhaseReportPublisher(invalidate)(item)).rejects.toThrow('Only completed');
    expect(h.phase).not.toHaveBeenCalled();
    item.status = 'completed'; item.report_type = 'round_forecast';
    await expect(createPhaseReportPublisher(invalidate)(item)).rejects.toThrow('content does not match');
    expect(invalidate).not.toHaveBeenCalled(); expect(h.emit).not.toHaveBeenCalled();
  });

  it('propagates a failed scope or cache read instead of announcing stale data', async () => {
    const error = new Error('Native report owner unavailable'); h.phase.mockRejectedValueOnce(error);
    await expect(createPhaseReportPublisher(invalidate)(report())).rejects.toBe(error);
    invalidate.mockRejectedValueOnce(error);
    await expect(createPhaseReportPublisher(invalidate)(report())).rejects.toBe(error);
    expect(h.emit).not.toHaveBeenCalled();
  });
});
