import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), superadmin: vi.fn(), scope: vi.fn(), prompt: vi.fn(),
  get: vi.fn(), getPrep: vi.fn(), create: vi.fn(), createPrep: vi.fn(), update: vi.fn(), updatePrep: vi.fn(),
  remove: vi.fn(), removePrep: vi.fn(), limit: vi.fn(), complete: vi.fn(), scoutingAccess: vi.fn(), enrolled: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireAuth: h.auth, isSuperadmin: h.superadmin,
  AuthError: class extends Error {} }));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: h.admin }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ isPlayerPhaseParticipant: h.enrolled }));
vi.mock('../phase-context', () => ({ loadPhaseMatchScope: h.scope, buildPhaseMatchAnalysisPrompt: h.prompt, buildPhaseMatchPrepPrompt: h.prompt }));
vi.mock('@/lib/supabase/queries/phase-ai-artifacts', () => ({ getPhaseMatchAnalysis: h.get, getPhaseMatchPrepAnalysis: h.getPrep,
  createPhaseMatchAnalysis: h.create, createPhaseMatchPrepAnalysis: h.createPrep, updatePhaseMatchAnalysis: h.update,
  updatePhaseMatchPrepAnalysis: h.updatePrep, deletePhaseMatchAnalysis: h.remove, deletePhaseMatchPrepAnalysis: h.removePrep,
  getPhaseScoutingAccess: h.scoutingAccess }));
vi.mock('../rate-limit', () => ({ checkAndRecordAiGeneration: h.limit }));
vi.mock('../client', () => ({ complete: h.complete }));
import { generatePhaseAnalysis } from '../phase-analysis';
const input = { phaseId: 'phase', matchId: 'match', kind: 'post_match' as const };
const scout = { ...input, kind: 'opponent_scout' as const };
const scheduled = { status: 'scheduled', player_1_id: 'p1', player_2_id: 'p2' };
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ player: { playerId: 'p1', isAdmin: false, isCreator: false } });
  h.scope.mockResolvedValue({ match: { status: 'completed', player_1_id: 'p1', player_2_id: 'p2' } });
  h.scoutingAccess.mockResolvedValue(scheduled); h.enrolled.mockResolvedValue(true);
  h.admin.mockResolvedValue(false); h.superadmin.mockReturnValue(false);
  h.get.mockResolvedValue(null); h.getPrep.mockResolvedValue(null); h.prompt.mockResolvedValue({ systemPrompt: 'system', userPrompt: 'user', hasUserTeam: true });
  h.create.mockResolvedValue({ id: 'artifact', status: 'pending' }); h.createPrep.mockResolvedValue({ id: 'prep', status: 'pending', player_id: 'p1' });
  h.update.mockResolvedValue(true); h.updatePrep.mockResolvedValue(true); h.remove.mockResolvedValue(true); h.removePrep.mockResolvedValue(true);
  h.limit.mockResolvedValue({ allowed: true });
  h.complete.mockResolvedValue({ content: JSON.stringify({ summary: 'Synthetic analysis', turning_point: 'Trade', mvp: { pokemon: 'SyntheticSpecies' }, game_breakdowns: [] }),
    model: 'actual-model', prompt_tokens: 4, completion_tokens: 5 });
});
describe('native phase analysis generation', () => {
  it.each(['completed', 'pending'])('returns %s artifacts before prompts, slots and model calls', async status => {
    h.get.mockResolvedValue({ id: 'old', status, created_at: new Date().toISOString() });
    expect((await generatePhaseAnalysis(input)).kind).toBe(status === 'completed' ? 'cached' : 'pending');
    expect(h.limit).not.toHaveBeenCalled(); expect(h.complete).not.toHaveBeenCalled(); expect(h.prompt).not.toHaveBeenCalled();
  });
  it('does not treat a creator as an admin', async () => {
    h.auth.mockResolvedValue({ player: { playerId: 'creator', isCreator: true, isAdmin: false } });
    await expect(generatePhaseAnalysis(input)).rejects.toThrow('Only match participants or admins');
    expect(h.get).not.toHaveBeenCalled(); expect(h.limit).not.toHaveBeenCalled();
  });
  it('uses the live phase admin guard for a nonparticipant analysis', async () => {
    h.auth.mockResolvedValue({ player: { playerId: 'phase-admin', isAdmin: false } }); h.admin.mockResolvedValue(true);
    h.get.mockResolvedValue({ status: 'completed' });
    expect((await generatePhaseAnalysis(input)).kind).toBe('cached');
    expect(h.admin).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'phase-admin' }), 'phase');
  });
  it('does not give regular admins access to opponent preparation', async () => {
    h.auth.mockResolvedValue({ player: { playerId: 'admin', isAdmin: true } });
    h.scope.mockResolvedValue({ match: { status: 'scheduled', player_1_id: 'p1', player_2_id: 'p2' } });
    await expect(generatePhaseAnalysis({ ...input, kind: 'opponent_scout' })).rejects.toThrow('Only match participants');
    expect(h.getPrep).not.toHaveBeenCalled();
  });
  it('does not allow a participant to request the opponent cache', async () => {
    h.scope.mockResolvedValue({ match: { status: 'scheduled', player_1_id: 'p1', player_2_id: 'p2' } });
    await expect(generatePhaseAnalysis({ ...input, kind: 'opponent_scout', perspectivePlayerId: 'p2' })).rejects.toThrow('Only match participants');
    expect(h.getPrep).not.toHaveBeenCalled();
  });
  it('claims a unique native artifact before charging and preserves the actual model', async () => {
    expect((await generatePhaseAnalysis(input)).kind).toBe('generated');
    expect(h.create).toHaveBeenCalledWith('phase', 'match', expect.any(String));
    expect(h.create.mock.invocationCallOrder[0]).toBeLessThan(h.limit.mock.invocationCallOrder[0]);
    expect(h.update).toHaveBeenCalledWith('artifact', expect.objectContaining({ status: 'completed', model_id: 'actual-model', analysis: expect.objectContaining({ summary: 'Synthetic analysis' }) }));
  });
  it('does not overwrite a deleted or replaced pending artifact', async () => {
    h.update.mockResolvedValue(false);
    expect(await generatePhaseAnalysis(input)).toEqual({ kind: 'superseded' });
  });
  it('regenerates a stale pending artifact by guarded discard and a new insert', async () => {
    h.get.mockResolvedValue({ status: 'pending', created_at: '2000-01-01T00:00:00Z' });
    expect((await generatePhaseAnalysis(input)).kind).toBe('generated');
    expect(h.remove).toHaveBeenCalledWith('phase', 'match');
    expect(h.remove.mock.invocationCallOrder[0]).toBeLessThan(h.create.mock.invocationCallOrder[0]);
  });
  it('uses the native perspective cache and shared scouting parser', async () => {
    h.scope.mockResolvedValue({ match: { status: 'scheduled', player_1_id: 'p1', player_2_id: 'p2' } });
    h.getPrep.mockResolvedValueOnce({ id: 'cached-prep', status: 'completed', player_id: 'p1' });
    expect((await generatePhaseAnalysis({ ...input, kind: 'opponent_scout' })).kind).toBe('cached');
    expect(h.getPrep).toHaveBeenCalledWith('phase', 'match', 'p1'); expect(h.limit).not.toHaveBeenCalled();
    h.complete.mockResolvedValue({ content: JSON.stringify({ opponent_profile: 'Synthetic scouting', signature_pokemon: [], tendencies: {}, recommendations: {},
      matchup_analysis: { your_advantages: 'Own team' }, suggested_picks: [{ pokemon: 'ShouldNotAppear' }], private_injected_field: 'secret' }),
      model: 'scout-model', prompt_tokens: 1, completion_tokens: 2 });
    expect((await generatePhaseAnalysis({ ...input, kind: 'opponent_scout' })).kind).toBe('generated');
    expect(h.updatePrep).toHaveBeenCalledWith('prep', expect.objectContaining({ status: 'completed', model_id: 'scout-model',
      analysis: expect.objectContaining({ opponent_profile: 'Synthetic scouting' }) }));
    expect(JSON.stringify(h.updatePrep.mock.calls)).not.toContain('ShouldNotAppear');
    expect(JSON.stringify(h.updatePrep.mock.calls)).not.toContain('private_injected_field');
  });
  it('denies a non-playing superadmin before enrollment or any report data', async () => {
    h.auth.mockResolvedValue({ player: { playerId: 'admin', isAdmin: true } });
    h.superadmin.mockReturnValue(true);
    await expect(generatePhaseAnalysis(scout)).rejects.toMatchObject({ statusCode: 403, code: 'ai_scouting_participants_only' });
    expect(h.enrolled).not.toHaveBeenCalled();
    expect(h.getPrep).not.toHaveBeenCalled();
    expect(h.prompt).not.toHaveBeenCalled();
  });
  it('rejects removed participants and unscheduled matches even if a cached report exists', async () => {
    h.getPrep.mockResolvedValue({ id: 'cached', status: 'completed' });
    h.enrolled.mockResolvedValueOnce(false);
    await expect(generatePhaseAnalysis(scout)).rejects.toMatchObject({ statusCode: 403 });
    h.scoutingAccess.mockResolvedValueOnce({ ...scheduled, status: 'completed' });
    await expect(generatePhaseAnalysis(scout)).rejects.toMatchObject({ statusCode: 400, code: 'ai_scouting_scheduled_only' });
    expect(h.getPrep).not.toHaveBeenCalled();
    expect(h.limit).not.toHaveBeenCalled();
  });
  it('never lets force replace a fresh pending claim or repeat a report with the same team state', async () => {
    const pending = { id: 'the-winner', status: 'pending', created_at: new Date().toISOString() };
    const cached = { id: 'finished', status: 'completed', has_user_team: true };
    h.getPrep.mockResolvedValueOnce(pending).mockResolvedValueOnce(cached)
      .mockResolvedValueOnce({ ...cached, has_user_team: false });
    expect(await generatePhaseAnalysis({ ...scout, force: true })).toEqual({ kind: 'pending', artifact: pending });
    expect(await generatePhaseAnalysis({ ...scout, force: true })).toEqual({ kind: 'cached', artifact: cached });
    expect(h.prompt).not.toHaveBeenCalled();
    h.prompt.mockResolvedValueOnce({ systemPrompt: 'system', userPrompt: 'user', hasUserTeam: false });
    expect(await generatePhaseAnalysis({ ...scout, force: true })).toMatchObject({ kind: 'cached' });
    expect(h.limit).not.toHaveBeenCalled();
    expect(h.removePrep).not.toHaveBeenCalled();
  });
  it.each([false, true])('charges and claims for force with an added team or playing admin (admin=%s)', async (isAdmin) => {
    h.auth.mockResolvedValue({ player: { playerId: 'p1', isAdmin } });
    const old = { id: 'finished', status: 'completed', has_user_team: isAdmin };
    h.getPrep.mockResolvedValue(old);
    h.limit.mockResolvedValueOnce({ allowed: false, limit: 10 });
    expect(await generatePhaseAnalysis({ ...scout, force: true })).toEqual({ kind: 'limited', limit: 10 });
    expect(h.removePrep).toHaveBeenCalledWith('phase', 'match', 'p1', old);
    expect(h.createPrep).toHaveBeenCalledWith('phase', 'match', 'p1', expect.any(String), true);
    expect(h.createPrep.mock.invocationCallOrder[0]).toBeLessThan(h.limit.mock.invocationCallOrder[0]);
    expect(h.limit).toHaveBeenCalledWith('p1', 'match-prep-analysis');
    expect(h.complete).not.toHaveBeenCalled();
  });
  it('does not charge when a concurrent scouting request wins the unique key', async () => {
    const pending = { id: 'the-winner', status: 'pending', created_at: new Date().toISOString() };
    h.getPrep.mockResolvedValueOnce(null).mockResolvedValueOnce(pending);
    h.createPrep.mockRejectedValueOnce({ code: '23505' });
    expect(await generatePhaseAnalysis({ ...scout, force: true })).toEqual({ kind: 'pending', artifact: pending });
    expect(h.limit).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });
  it('does not replace a concurrent winner during a guarded stale retry', async () => {
    const stale = { id: 'stale', status: 'pending', created_at: '2000-01-01T00:00:00Z' };
    const pending = { id: 'the-winner', status: 'pending', created_at: new Date().toISOString() };
    h.getPrep.mockResolvedValueOnce(stale).mockResolvedValueOnce(pending);
    h.removePrep.mockResolvedValueOnce(false);
    expect(await generatePhaseAnalysis({ ...scout, force: true })).toEqual({ kind: 'pending', artifact: pending });
    expect(h.removePrep).toHaveBeenCalledWith('phase', 'match', 'p1', stale);
    expect(h.createPrep).not.toHaveBeenCalled();
    expect(h.limit).not.toHaveBeenCalled();
  });
  it('does not spend a slot for a failed claim or a failed prompt read', async () => {
    h.create.mockRejectedValueOnce(new Error('Unique scope conflict'));
    await expect(generatePhaseAnalysis(input)).rejects.toThrow('Unique scope conflict');
    expect(h.limit).not.toHaveBeenCalled();
    h.prompt.mockRejectedValueOnce(new Error('Native context unavailable'));
    await expect(generatePhaseAnalysis(input)).rejects.toThrow('Native context unavailable');
    expect(h.limit).not.toHaveBeenCalled();
  });
  it('records quota refusal without calling the provider', async () => {
    h.limit.mockResolvedValue({ allowed: false, limit: 10 });
    expect(await generatePhaseAnalysis(input)).toEqual({ kind: 'limited', limit: 10 });
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledWith('artifact', { status: 'failed', error: 'daily_limit_reached' });
  });
  it('settles a safe failure but propagates the distinct original error', async () => {
    const failure = new Error('Synthetic provider unavailable'); h.complete.mockRejectedValue(failure);
    await expect(generatePhaseAnalysis(input)).rejects.toBe(failure);
    expect(h.update).toHaveBeenCalledWith('artifact', { status: 'failed', error: 'ai_analysis_failed: Error' });
  });
});
