/**
 * The `getMatchAnalysisContext` tool takes a match id from the model. It answers only for a match the requesting player
 * may see (the rules of `/api/ai/agent/analyze-match`): a participant, or a site admin for a match in a post-match
 * status. Everything else, and a call with no requester, gets the same refusal as a match that does not exist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/context-builder', () => ({ gatherMatchContext: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayerById: vi.fn() }));

import { getMatchAnalysisContext } from '../match-context';
import { executeTool } from '../execute';
import { gatherMatchContext } from '@/lib/ai/context-builder';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getPlayerById } from '@/lib/supabase/queries/players';

const MATCH_ID = '00000000-0000-4000-8000-0000000000a1';
const ME = '00000000-0000-4000-8000-000000000011';
const OPPONENT = '00000000-0000-4000-8000-000000000012';
const STRANGER = '00000000-0000-4000-8000-000000000099';
const REFUSAL = 'No match context is available for that match id.';

const match = (status: string, p1 = ME, p2 = OPPONENT) => ({ id: MATCH_ID, status, player_1_id: p1, player_2_id: p2 }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(gatherMatchContext).mockResolvedValue({ context: 'MATCH-CTX', gen: 9 });
  vi.mocked(getPlayerById).mockResolvedValue({ id: ME, is_admin: false } as never);
});

describe('getMatchAnalysisContext: who may read a match', () => {
  it('answers for a match the requester plays in, as player 1 or player 2', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match('completed'));
    await expect(getMatchAnalysisContext({ matchId: MATCH_ID, requesterId: ME })).resolves.toEqual({
      match_id: MATCH_ID,
      gen: 9,
      context: 'MATCH-CTX',
    });

    vi.mocked(getMatchById).mockResolvedValue(match('scheduled', OPPONENT, ME));
    await expect(getMatchAnalysisContext({ matchId: MATCH_ID, requesterId: ME })).resolves.toMatchObject({ context: 'MATCH-CTX' });
    expect(gatherMatchContext).toHaveBeenCalledWith(MATCH_ID);
  });

  it('refuses a match the requester is not in, and never gathers its context', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match('completed', OPPONENT, STRANGER));

    await expect(getMatchAnalysisContext({ matchId: MATCH_ID, requesterId: ME })).rejects.toThrow(REFUSAL);
    expect(gatherMatchContext).not.toHaveBeenCalled();
  });

  it('refuses a call with no requester (the server sets it; a direct call without one is refused)', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match('completed'));

    await expect(getMatchAnalysisContext({ matchId: MATCH_ID } as never)).rejects.toThrow(REFUSAL);
    expect(getMatchById).not.toHaveBeenCalled();
    expect(gatherMatchContext).not.toHaveBeenCalled();
  });

  it('says the same thing for a match that does not exist, so ids cannot be probed', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);

    await expect(getMatchAnalysisContext({ matchId: MATCH_ID, requesterId: ME })).rejects.toThrow(REFUSAL);
  });

  describe('a site admin', () => {
    beforeEach(() => {
      vi.mocked(getPlayerById).mockResolvedValue({ id: STRANGER, is_admin: true } as never);
    });

    it.each(['completed', 'pending_confirmation'])('may read a %s match they are not in (the post-match rule)', async (status) => {
      vi.mocked(getMatchById).mockResolvedValue(match(status, OPPONENT, ME));
      await expect(getMatchAnalysisContext({ matchId: MATCH_ID, requesterId: STRANGER })).resolves.toMatchObject({ context: 'MATCH-CTX' });
    });

    it.each(['scheduled', 'in_progress', 'disputed'])('may not read a %s match they are not in (opponent prep stays private)', async (status) => {
      vi.mocked(getMatchById).mockResolvedValue(match(status, OPPONENT, ME));
      await expect(getMatchAnalysisContext({ matchId: MATCH_ID, requesterId: STRANGER })).rejects.toThrow(REFUSAL);
      expect(gatherMatchContext).not.toHaveBeenCalled();
    });
  });

  it('a non-admin stranger with a completed match is refused (the row says so, not the claim)', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match('completed', OPPONENT, ME));
    vi.mocked(getPlayerById).mockResolvedValue({ id: STRANGER, is_admin: false } as never);
    await expect(getMatchAnalysisContext({ matchId: MATCH_ID, requesterId: STRANGER })).rejects.toThrow(REFUSAL);
  });

  it('does not look the requester up when they play in the match', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match('completed'));
    await getMatchAnalysisContext({ matchId: MATCH_ID, requesterId: ME });
    expect(getPlayerById).not.toHaveBeenCalled();
  });
});

describe('through the tool dispatcher', () => {
  it('a direct executeTool call that skipped applyToolOverrides is refused at the schema, before any read', async () => {
    const res = await executeTool('getMatchAnalysisContext', { matchId: MATCH_ID });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/^Invalid input for 'getMatchAnalysisContext'.*requesterId/);
    expect(getMatchById).not.toHaveBeenCalled();
    expect(gatherMatchContext).not.toHaveBeenCalled();
  });

  it('hands the model the refusal as a tool error, not the match', async () => {
    vi.mocked(getMatchById).mockResolvedValue(match('completed', OPPONENT, STRANGER));

    const res = await executeTool('getMatchAnalysisContext', { matchId: MATCH_ID, requesterId: ME });

    expect(res).toEqual({ ok: false, error: REFUSAL });
  });
});
