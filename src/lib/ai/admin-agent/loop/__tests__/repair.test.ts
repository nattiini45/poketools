import { describe, expect, it } from 'vitest';
import { adminIdOf } from '../../store/ids';
import type { MessageRecord, NewMessage } from '../../store/types';
import { rebuildTranscript, firstPairingViolation, danglingToolUses } from '../transcript';
import { appendHarnessEvent, danglingRepairMessage } from '../repair';

const ADMIN = adminIdOf('11111111-1111-4111-8111-111111111111');
const CONVERSATION = '33333333-3333-4333-8333-333333333333';

function record(seq: number, message: NewMessage): MessageRecord {
  return {
    conversation_id: CONVERSATION,
    seq,
    role: message.role,
    kind: message.kind,
    content: message.content,
    content_purged_at: null,
    ui: message.ui ?? null,
    model: null,
    stop_reason: null,
    usage: null,
    client_msg_id: null,
    created_at: '2026-10-27T10:00:00.000Z',
  } as MessageRecord;
}

/** A stored conversation and the two calls `appendHarnessEvent` makes of the store. */
function conversation(...messages: NewMessage[]) {
  const stored = messages.map((message, index) => record(index + 1, message));
  return {
    stored,
    store: {
      messages: {
        loadTail: async (_admin: unknown, _conversation: string, limit: number) => stored.slice(-limit),
        appendMessage: async (_admin: unknown, _conversation: string, input: NewMessage) => {
          const row = record(stored.length + 1, input);
          stored.push(row);
          return { message: row, duplicate: false };
        },
      },
    },
  };
}

const user = (text: string): NewMessage => ({ role: 'user', kind: 'chat', content: [{ type: 'text', text }] });
const assistant = (...blocks: unknown[]): NewMessage => ({ role: 'assistant', kind: 'chat', content: blocks as never });
const toolUse = (id: string, name: string) => ({ type: 'tool_use', id, name, input: {} });

describe('appendHarnessEvent', () => {
  it('appends the event directly when the history is sound', async () => {
    const { stored, store } = conversation(user('hi'), assistant({ type: 'text', text: 'hello' }));
    await appendHarnessEvent(store, ADMIN, CONVERSATION, 'proposal_declined', { proposal_id: 'p1' });
    expect(stored.map((row) => `${row.role}:${row.kind}`)).toEqual(['user:chat', 'assistant:chat', 'system:harness_event']);
  });

  it('answers the calls a cut-off turn left dangling with unknown_outcome BEFORE the event, so the history stays valid', async () => {
    const { stored, store } = conversation(user('build it'), assistant({ type: 'text', text: 'ok' }, toolUse('toolu_a', 'propose_build'), toolUse('toolu_b', 'plan_get')));
    await appendHarnessEvent(store, ADMIN, CONVERSATION, 'proposal_declined', { proposal_id: 'p1' });
    expect(stored.map((row) => `${row.role}:${row.kind}`)).toEqual(['user:chat', 'assistant:chat', 'user:tool_results', 'system:harness_event']);
    const repair = stored[2].content as Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
    expect(repair.map((block) => block.tool_use_id)).toEqual(['toolu_a', 'toolu_b']);
    for (const block of repair) {
      expect(JSON.parse(block.content)).toEqual({ ok: false, code: 'unknown_outcome' });
      expect(block.is_error).toBe(true);
    }
    // The whole history is one the loop accepts at the next turn: no pairing violation, nothing left dangling.
    const transcript = rebuildTranscript(stored);
    expect(firstPairingViolation(transcript)).toBeNull();
    expect(danglingToolUses(transcript)).toEqual([]);
  });

  it('writes nothing about tool calls when the last message already is a result or an event', async () => {
    const { stored, store } = conversation(user('hi'), assistant(toolUse('toolu_a', 'plan_get')), danglingRepairMessage([{ type: 'tool_use', id: 'toolu_a', name: 'plan_get', input: {} }]));
    await appendHarnessEvent(store, ADMIN, CONVERSATION, 'proposal_declined');
    expect(stored.map((row) => `${row.role}:${row.kind}`)).toEqual(['user:chat', 'assistant:chat', 'user:tool_results', 'system:harness_event']);
  });
});
