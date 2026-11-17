import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ from: vi.fn(), settle: vi.fn(), match: vi.fn() }));
vi.mock('../../client', () => ({ supabase: { from: h.from } }));
vi.mock('../ai-artifacts', () => ({ settleAiArtifact: h.settle }));
vi.mock('../phase-matches', () => ({ getPhaseMatchById: h.match }));
import { createPhaseMatchAnalysis, createPhaseMatchPrepAnalysis, deletePhaseMatchAnalysis,
  getPhaseMatchAnalysis, getPhaseMatchPrepAnalysis, getPhasePlayerPrepTeam, getPhaseAiParticipants,
  updatePhaseMatchAnalysis, updatePhaseMatchPrepAnalysis } from '../phase-ai-artifacts';
const phaseId = '20000000-0000-0000-0000-000000000001';
const matchId = '20000000-0000-0000-0000-000000000002';
const row = { id: 'artifact', match_id: matchId, player_id: 'p1', model_id: 'model', analysis: {},
  status: 'pending', error: null, created_at: null, updated_at: null, has_user_team: false,
  prompt_tokens: null, completion_tokens: null, generation_time_ms: null };
function query(data: unknown, error: unknown = null) {
  const chain = { select: vi.fn(), eq: vi.fn(), insert: vi.fn(), delete: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(), order: vi.fn(), range: vi.fn(),
    then: (resolve: (result: { data: unknown; error: unknown }) => unknown) => Promise.resolve(resolve({ data, error })) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.insert.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain); chain.single.mockResolvedValue({ data, error }); chain.maybeSingle.mockResolvedValue({ data, error });
  chain.order.mockReturnValue(chain); chain.range.mockReturnValue(chain);
  h.from.mockReturnValue(chain);
  return chain;
}
beforeEach(() => { vi.clearAllMocks(); h.match.mockResolvedValue({ phase_id: phaseId }); h.settle.mockResolvedValue(true); });
describe('native phase artifact persistence', () => {
  it('pages the native enrollment with a stable order and maps public player fields only', async () => {
    const q = query([{ player: { id: 'p1', name: 'Aster', avatar_url: null, ban_reason: 'private' } }]);
    const end = query([]);
    h.from.mockReturnValueOnce(q).mockReturnValueOnce(end);
    expect(await getPhaseAiParticipants(phaseId)).toEqual([{ id: 'p1', name: 'Aster', avatar_url: null }]);
    expect(q.eq).toHaveBeenCalledWith('phase_id', phaseId); expect(q.order).toHaveBeenCalledWith('player_id');
    expect(q.range).toHaveBeenCalledWith(0, 999);
    expect(q.select).toHaveBeenCalledWith('player:players!phase_participants_player_id_fkey(id,name,avatar_url)');
  });
  it('uses the native analysis table, explicit payload columns and the requested match', async () => {
    const q = query(row);
    expect(await getPhaseMatchAnalysis(phaseId, matchId)).toEqual(expect.objectContaining({ id: 'artifact', match_id: matchId }));
    expect(h.from).toHaveBeenCalledWith('phase_match_analyses'); expect(q.eq).toHaveBeenCalledWith('match_id', matchId);
    expect(q.select).not.toHaveBeenCalledWith('*');
  });
  it('keeps scouting and prep-team reads perspective-scoped', async () => {
    const q = query(row);
    await getPhaseMatchPrepAnalysis(phaseId, matchId, 'p1');
    expect(h.from).toHaveBeenCalledWith('phase_match_prep_analyses'); expect(q.eq).toHaveBeenCalledWith('player_id', 'p1');
    await getPhasePlayerPrepTeam(phaseId, matchId, 'p1');
    expect(h.from).toHaveBeenCalledWith('phase_match_prep_teams'); expect(q.select).toHaveBeenCalledWith('pokemon');
  });
  it('rejects cross-phase ids before any artifact read or write', async () => {
    h.match.mockResolvedValue({ phase_id: 'different' }); query(row);
    await expect(createPhaseMatchAnalysis(phaseId, matchId, 'model')).rejects.toThrow('not found in phase');
    expect(h.from).not.toHaveBeenCalled();
  });
  it('inserts pending artifacts only into their native tables', async () => {
    const q = query(row);
    await createPhaseMatchAnalysis(phaseId, matchId, 'requested-model');
    expect(q.insert).toHaveBeenCalledWith({ match_id: matchId, model_id: 'requested-model', status: 'pending' });
    await createPhaseMatchPrepAnalysis(phaseId, matchId, 'p1', 'requested-model', true);
    expect(q.insert).toHaveBeenCalledWith({ match_id: matchId, player_id: 'p1', model_id: 'requested-model', status: 'pending', has_user_team: true });
    expect(h.from).toHaveBeenCalledWith('phase_match_prep_analyses');
  });
  it('settles both native tables through the shared compare-and-set helper', async () => {
    h.settle.mockResolvedValue(false);
    expect(await updatePhaseMatchAnalysis('artifact', { status: 'failed', error: 'failure-code' })).toBe(false);
    expect(h.settle).toHaveBeenCalledWith('phase_match_analyses', 'artifact', 'failed', { error: 'failure-code' });
    expect(await updatePhaseMatchPrepAnalysis('prep', { status: 'completed', has_user_team: true })).toBe(false);
    expect(h.settle).toHaveBeenCalledWith('phase_match_prep_analyses', 'prep', 'completed', { has_user_team: true });
  });
  it('guards discard with the exact id and observed status', async () => {
    const read = query(row); const removed = query([{ id: row.id }]);
    h.from.mockReturnValueOnce(read).mockReturnValueOnce(removed);
    expect(await deletePhaseMatchAnalysis(phaseId, matchId)).toBe(true);
    expect(removed.eq).toHaveBeenCalledWith('id', row.id); expect(removed.eq).toHaveBeenCalledWith('status', 'pending');
  });
  it('propagates query errors instead of treating them as missing artifacts', async () => {
    const error = new Error('Synthetic query failure'); query(null, error);
    await expect(getPhaseMatchAnalysis(phaseId, matchId)).rejects.toBe(error);
  });
});
