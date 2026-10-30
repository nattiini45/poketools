import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked Supabase: no network. (memory.test.ts is the opt-in live-DB suite.)
const { mockBuilder } = vi.hoisted(() => {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['from', 'select', 'insert', 'update', 'eq']) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.single = vi.fn();
  return { mockBuilder: builder };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import {
  appendMessages,
  conversationBelongsTo,
  createConversation,
  DRY_RUN_CONVERSATION_ID,
  dryRunIdentity,
  getOrCreateProfile,
  isDryRunUser,
} from '../memory';
import { z } from 'zod';

const WRITE_RESULT = { id: 'conv-1', last_message_at: '2026-09-29T10:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of ['from', 'select', 'insert', 'update', 'eq']) {
    mockBuilder[method].mockReturnValue(mockBuilder);
  }
});

describe('createConversation', () => {
  it('returns only id and last_message_at instead of the whole row', async () => {
    mockBuilder.single.mockResolvedValueOnce({ data: WRITE_RESULT, error: null });

    const result = await createConversation('player-1', 'linden_teambuilding', [
      { role: 'user', content: 'Build me a team.' },
    ]);

    expect(mockBuilder.from).toHaveBeenCalledWith('agent_conversations');
    expect(mockBuilder.insert).toHaveBeenCalledWith({
      player_id: 'player-1',
      persona: 'linden_teambuilding',
      messages: [{ role: 'user', content: 'Build me a team.' }],
    });
    expect(mockBuilder.select).toHaveBeenCalledTimes(1);
    expect(mockBuilder.select).toHaveBeenCalledWith('id, last_message_at');
    expect(mockBuilder.select).not.toHaveBeenCalledWith('*');
    expect(result).toEqual(WRITE_RESULT);
  });

  it('throws the insert error', async () => {
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: new Error('insert failed') });

    await expect(createConversation('player-1', 'kale', [])).rejects.toThrow('insert failed');
  });

  it('returns an id-only result for eval dry runs without touching the DB', async () => {
    const result = await createConversation('eval-harness', 'kale', []);

    expect(result).toEqual({ id: DRY_RUN_CONVERSATION_ID, last_message_at: expect.any(String) });
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });
});

describe('appendMessages', () => {
  it('writes the merged messages and returns only id and last_message_at', async () => {
    mockBuilder.single
      .mockResolvedValueOnce({
        data: { messages: [{ role: 'user', content: 'Build me a team.' }] },
        error: null,
      })
      .mockResolvedValueOnce({ data: WRITE_RESULT, error: null });

    const result = await appendMessages('conv-1', [{ role: 'assistant', content: 'Which format?' }]);

    // The read still needs the current blob to merge into…
    expect(mockBuilder.select).toHaveBeenNthCalledWith(1, 'messages');
    expect(mockBuilder.update).toHaveBeenCalledWith({
      messages: [
        { role: 'user', content: 'Build me a team.' },
        { role: 'assistant', content: 'Which format?' },
      ],
      last_message_at: expect.any(String),
    });
    // …but the write no longer echoes the merged blob back.
    expect(mockBuilder.select).toHaveBeenNthCalledWith(2, 'id, last_message_at');
    expect(mockBuilder.select).not.toHaveBeenCalledWith('*');
    expect(result).toEqual(WRITE_RESULT);
    expect(Object.keys(result).sort()).toEqual(['id', 'last_message_at']);
  });

  it('throws the read error before writing', async () => {
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: new Error('read failed') });

    await expect(appendMessages('conv-1', [])).rejects.toThrow('read failed');
    expect(mockBuilder.update).not.toHaveBeenCalled();
  });

  it('throws the update error', async () => {
    mockBuilder.single
      .mockResolvedValueOnce({ data: { messages: [] }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('update failed') });

    await expect(appendMessages('conv-1', [])).rejects.toThrow('update failed');
  });

  it('returns the dry-run id without touching the DB', async () => {
    const result = await appendMessages(DRY_RUN_CONVERSATION_ID, [{ role: 'assistant', content: 'hi' }]);

    expect(result).toEqual({ id: DRY_RUN_CONVERSATION_ID, last_message_at: expect.any(String) });
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });
});

describe('dryRunIdentity (the eval harness identity)', () => {
  const uuid = z.string().uuid();

  it('is a valid UUID, so the strict tool schemas accept the ids the server sets from it', () => {
    for (const model of ['deepseek-v4-pro', 'mimo-v2.6-pro', undefined]) {
      expect(uuid.safeParse(dryRunIdentity(model)).success).toBe(true);
    }
  });

  it('is deterministic per model and differs between models', () => {
    expect(dryRunIdentity('deepseek-v4-pro')).toBe(dryRunIdentity('deepseek-v4-pro'));
    expect(dryRunIdentity('deepseek-v4-pro')).not.toBe(dryRunIdentity('mimo-v2.6-pro'));
  });

  it('still opts out of every write and every read: nothing touches the DB', async () => {
    const id = dryRunIdentity('deepseek-v4-pro');
    expect(isDryRunUser(id)).toBe(true);

    expect(await createConversation(id, 'kale', [])).toEqual({ id: DRY_RUN_CONVERSATION_ID, last_message_at: expect.any(String) });
    expect(await conversationBelongsTo(DRY_RUN_CONVERSATION_ID, id, 'kale')).toBe(true);
    await getOrCreateProfile(id);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('carries the model under test as the router first preference', async () => {
    const profile = await getOrCreateProfile(dryRunIdentity('deepseek-v4-pro'));
    expect(profile.model_priority).toEqual(['deepseek-v4-pro']);
    expect((await getOrCreateProfile(dryRunIdentity())).model_priority).toEqual([]);
  });

  it('the old eval-<model> ids keep working', async () => {
    expect(isDryRunUser('eval-harness')).toBe(true);
    expect((await getOrCreateProfile('eval-some-model')).model_priority).toEqual(['some-model']);
  });

  it('a real player id is not a dry run', () => {
    expect(isDryRunUser('00000000-0000-4000-8000-000000000011')).toBe(false);
    expect(isDryRunUser('5b1c2f7e-0d0a-4c3e-9a55-1f2b3c4d5e6f')).toBe(false);
  });
});
