import { beforeEach, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['from', 'select', 'eq', 'or', 'order', 'insert', 'update']) builder[method] = vi.fn(() => builder);
  builder.range = vi.fn();
  builder.maybeSingle = vi.fn();
  builder.single = vi.fn();
  return { db: builder };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: db }));
import { getAgentPhaseHistory, getAgentPhasePrep } from '../agent-player-context';
import { insertNativeAgentSuggestion } from '../agent-suggestions';
import { appendMessages, recordSuggestion } from '@/lib/ai/agent/memory';

const phase = '00000000-0000-4000-8000-000000000001';
const player = '00000000-0000-4000-8000-000000000002';
const opponent = '00000000-0000-4000-8000-000000000003';

beforeEach(() => {
  vi.clearAllMocks();
  db.range.mockResolvedValue({ data: [{ id: 'match', phase_id: phase, round: { phase_id: phase },
    player_1_id: player, player_2_id: opponent, winner_id: player }], count: 25, error: null });
  db.maybeSingle.mockResolvedValue({ data: { pokemon: [{ species: 'Own team' }] }, error: null });
  db.single.mockResolvedValue({ data: { id: 'suggestion' }, error: null });
});

it('reads completed native history with a stable bounded sample and no private columns', async () => {
  const history = await getAgentPhaseHistory(phase, player);
  expect(history.total).toBe(25);
  expect(history.truncated).toBe(true);
  expect(db.from).toHaveBeenCalledExactlyOnceWith('phase_matches');
  expect(db.eq).toHaveBeenCalledWith('status', 'completed');
  expect(db.eq).toHaveBeenCalledWith('phase_id', phase);
  expect(db.range).toHaveBeenCalledWith(0, 19);
  expect(db.order).toHaveBeenCalledWith('id');
  expect(db.select.mock.calls[0][0]).not.toMatch(/\*|notes|submitter|confirmed/);
  expect(db.select.mock.calls[0][1]).toEqual({ count: 'exact' });
});

it('selects both directions of only the actual pair for H2H', async () => {
  await getAgentPhaseHistory(phase, player, opponent);
  expect(db.or).toHaveBeenCalledExactlyOnceWith(
    `and(player_1_id.eq."${player}",player_2_id.eq."${opponent}"),and(player_1_id.eq."${opponent}",player_2_id.eq."${player}")`,
  );
});

it('never reads opponent private prep or unneeded prep metadata', async () => {
  await expect(getAgentPhasePrep(phase, player)).resolves.toEqual([{ species: 'Own team' }]);
  expect(db.from).toHaveBeenCalledWith('phase_match_prep_teams');
  expect(db.select).toHaveBeenCalledWith('pokemon');
  expect(db.eq).toHaveBeenCalledWith('player_id', player);
  expect(db.eq).toHaveBeenCalledWith('match_id', phase);
});

it('rejects malformed ids before querying', async () => {
  await expect(getAgentPhaseHistory('bad', player)).rejects.toThrow();
  await expect(getAgentPhasePrep(phase, 'bad')).rejects.toThrow();
  expect(db.from).not.toHaveBeenCalled();
});

it.each([
  { data: null, count: null, error: null },
  { data: [], count: 0, error: new Error('db read failed') },
  { data: [{ phase_id: phase, round: { phase_id: opponent } }], count: 1, error: null },
])('fails closed on incomplete or failed native history %#', async result => {
  db.range.mockResolvedValue(result);
  await expect(getAgentPhaseHistory(phase, player)).rejects.toThrow();
  expect(db.from).toHaveBeenCalledExactlyOnceWith('phase_matches');
});

it('propagates prep and suggestion storage failures', async () => {
  db.maybeSingle.mockResolvedValue({ data: null, error: new Error('prep failed') });
  await expect(getAgentPhasePrep(phase, player)).rejects.toThrow('prep failed');
  db.single.mockResolvedValue({ data: null, error: new Error('write failed') });
  await expect(insertNativeAgentSuggestion({ playerId: player, conversationId: opponent, phaseMatchId: phase,
    contextFormat: 'gen9ou', proposedTeam: null, reasoning: null, topicTags: [] })).rejects.toThrow('write failed');
});

it('sets phase_match_id exclusively and leaves the existing standalone suggestion contract unchanged', async () => {
  const opaque = { match_id: 'opaque legacy field', team: ['Pikachu'] };
  await insertNativeAgentSuggestion({ playerId: player, conversationId: opponent, phaseMatchId: phase,
    contextFormat: 'gen9ou', proposedTeam: opaque, reasoning: null, topicTags: [] });
  expect(db.insert.mock.calls[0][0]).toMatchObject({ match_id: null, phase_match_id: phase, proposed_team: opaque });
  await recordSuggestion({ playerId: player, conversationId: opponent, matchId: phase,
    contextFormat: 'gen9ou', proposedTeam: opaque });
  expect(db.insert.mock.calls[1][0]).toMatchObject({ match_id: phase, proposed_team: opaque });
  expect(db.insert.mock.calls[1][0]).not.toHaveProperty('phase_match_id');
  expect(opaque).toEqual({ match_id: 'opaque legacy field', team: ['Pikachu'] });
});

it('preserves historical conversation tool input/result blobs byte-for-byte during an ordinary append', async () => {
  const old = { role: 'assistant' as const, content: 'Historical response',
    tool_calls: [{ id: 'call', name: 'getMatchHistory', input: { tournament_id: phase, match_id: player } }],
    tool_results: [{ call_id: 'call', name: 'getMatchHistory', output: { match_id: opponent, opaque: ['unchanged'] } }] };
  const before = JSON.stringify(old);
  db.single.mockResolvedValueOnce({ data: { messages: [old] }, error: null })
    .mockResolvedValueOnce({ data: { id: 'conversation', last_message_at: 'now' }, error: null });
  await appendMessages(opponent, [{ role: 'user', content: 'New response' }]);
  expect(JSON.stringify(db.update.mock.calls[0][0].messages[0])).toBe(before);
  expect(JSON.stringify(old)).toBe(before);
  expect(db.update.mock.calls[0][0]).not.toHaveProperty('phase_match_id');
});
