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
  createConversation,
  DRY_RUN_CONVERSATION_ID,
} from '../memory';

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
