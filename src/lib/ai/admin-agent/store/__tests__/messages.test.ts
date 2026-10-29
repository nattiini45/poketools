/** The transcript: seq allocation by compare-and-set, idempotent client ids, history loading behind the admin check. */
import { describe, expect, it } from 'vitest';
import { adminIdOf } from '../ids';
import { createAdminAgentStore } from '../create';
import type { NewMessage } from '../types';
import { ADMIN, CONVERSATION, FakeDb, NOW, OTHER_ADMIN, eqOf, hasStep, ownedRow, ownsConversation } from './fake-db';

const admin = adminIdOf(ADMIN);
const other = adminIdOf(OTHER_ADMIN);

function setup() {
  const db = new FakeDb();
  const store = createAdminAgentStore(db.client, { now: () => NOW });
  return { db, m: store.messages };
}

const message = (seq: number, extra: Record<string, unknown> = {}) => ({
  conversation_id: CONVERSATION,
  seq,
  role: 'user',
  kind: 'chat',
  content: [{ type: 'text', text: 'hi' }],
  content_purged_at: null,
  ui: null,
  model: null,
  stop_reason: null,
  usage: null,
  client_msg_id: null,
  created_at: NOW.toISOString(),
  ...extra,
});

const input: NewMessage = { role: 'user', kind: 'chat', content: [{ type: 'text', text: 'hi' }] };

describe('appendMessage', () => {
  it('advances seq_head by compare-and-set, then inserts at the number it took', async () => {
    const { db, m } = setup();
    ownsConversation(db, { seq_head: 4 });
    db.on('admin_agent_conversations', 'update', { data: { seq_head: 5 } });
    db.on('admin_agent_messages', 'insert', { data: message(5) });

    const result = await m.appendMessage(admin, CONVERSATION, { ...input, clientMsgId: 'c-1' });
    expect(result).toEqual({ message: message(5), duplicate: false });

    const advance = db.to('admin_agent_conversations', 'update')[0];
    expect(advance.payload).toEqual({ seq_head: 5, last_message_at: NOW.toISOString() });
    expect(eqOf(advance, 'seq_head')).toBe(4);
    expect(eqOf(advance, 'admin_id')).toBe(ADMIN);
    expect(db.to('admin_agent_messages', 'insert')[0].payload).toMatchObject({
      conversation_id: CONVERSATION,
      seq: 5,
      role: 'user',
      kind: 'chat',
      client_msg_id: 'c-1',
      ui: null,
    });
    // The compare-and-set came before the insert.
    expect(db.calls.indexOf(advance)).toBeLessThan(db.calls.indexOf(db.to('admin_agent_messages', 'insert')[0]));
  });

  it('stores the model, stop reason, usage and ui of an assistant message', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    db.on('admin_agent_conversations', 'update', { data: { seq_head: 1 } });
    db.on('admin_agent_messages', 'insert', { data: message(1, { role: 'assistant' }) });
    await m.appendMessage(admin, CONVERSATION, {
      role: 'assistant',
      kind: 'chat',
      content: [{ type: 'thinking', thinking: 't', signature: 's' }],
      ui: { blocks: [] },
      model: 'claude-opus-5-5',
      stopReason: 'end_turn',
      usage: { input_tokens: 1 },
    });
    expect(db.to('admin_agent_messages', 'insert')[0].payload).toMatchObject({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1 },
      ui: { blocks: [] },
      client_msg_id: null,
    });
  });

  it('returns the stored message for a client id it already has and writes nothing', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    db.on('admin_agent_messages', 'select', { data: message(3, { client_msg_id: 'c-1' }) });
    const result = await m.appendMessage(admin, CONVERSATION, { ...input, clientMsgId: 'c-1' });
    expect(result.duplicate).toBe(true);
    expect(result.message.seq).toBe(3);
    expect(db.to('admin_agent_conversations', 'update')).toHaveLength(0);
    expect(db.to('admin_agent_messages', 'insert')).toHaveLength(0);
  });

  it('resolves a concurrent retry that loses the unique client-id race to the winner\'s message', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    db.on('admin_agent_messages', 'select', { data: null }, true);
    db.on('admin_agent_conversations', 'update', { data: { seq_head: 1 } });
    db.on('admin_agent_messages', 'insert', {
      error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_admin_agent_messages_client_msg"' },
    });
    db.on('admin_agent_messages', 'select', { data: message(1, { client_msg_id: 'c-1' }) });
    const result = await m.appendMessage(admin, CONVERSATION, { ...input, clientMsgId: 'c-1' });
    expect(result).toMatchObject({ duplicate: true, message: { seq: 1 } });
  });

  it('re-reads the head and retries when another appender advanced it first', async () => {
    const { db, m } = setup();
    let reads = 0;
    db.when(
      (c) => c.table === 'admin_agent_conversations' && c.op === 'select',
      () => ({ data: ownedRow({ seq_head: reads++ === 0 ? 2 : 3 }) }),
    );
    let updates = 0;
    db.on('admin_agent_conversations', 'update', (call) => {
      updates += 1;
      // The first compare-and-set (expecting 2) loses; the second (expecting 3) wins.
      return eqOf(call, 'seq_head') === 3 ? { data: { seq_head: 4 } } : { data: null };
    });
    db.on('admin_agent_messages', 'insert', { data: message(4) });
    const result = await m.appendMessage(admin, CONVERSATION, input);
    expect(result.message.seq).toBe(4);
    expect(updates).toBe(2);
    expect(db.to('admin_agent_messages', 'insert')).toHaveLength(1);
  });

  it('starts again above a primary-key collision with a row it did not see', async () => {
    const { db, m } = setup();
    ownsConversation(db, { seq_head: 0 });
    db.on('admin_agent_conversations', 'update', { data: { seq_head: 1 } });
    db.on('admin_agent_messages', 'insert', { error: { code: '23505', message: 'duplicate key value violates unique constraint "admin_agent_messages_pkey"' } }, true);
    db.on('admin_agent_messages', 'insert', { data: message(2) });
    const result = await m.appendMessage(admin, CONVERSATION, input);
    expect(result.message.seq).toBe(2);
    const seqs = db.to('admin_agent_messages', 'insert').map((c) => (c.payload as { seq: number }).seq);
    expect(seqs).toEqual([1, 2]);
  });

  it('gives up with a db error after repeated contention', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    db.on('admin_agent_conversations', 'update', { data: null });
    await expect(m.appendMessage(admin, CONVERSATION, input)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError', operation: 'messages.append' });
  });

  it('maps any other insert failure and writes no second row', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    db.on('admin_agent_conversations', 'update', { data: { seq_head: 1 } });
    db.on('admin_agent_messages', 'insert', { error: { code: '23514', message: 'violates check constraint "admin_agent_messages_content_size"' } });
    await expect(m.appendMessage(admin, CONVERSATION, input)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError', dbCode: '23514' });
    expect(db.to('admin_agent_messages', 'insert')).toHaveLength(1);
  });

  it("refuses another admin's conversation before writing anything", async () => {
    const { db, m } = setup();
    ownsConversation(db);
    await expect(m.appendMessage(other, CONVERSATION, input)).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(db.calls.every((c) => c.op === 'select' && c.table === 'admin_agent_conversations')).toBe(true);
  });

  it('refuses private fields and webhook URLs before anything is written', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    await expect(
      m.appendMessage(admin, CONVERSATION, {
        role: 'assistant',
        kind: 'chat',
        content: [{ type: 'tool_use', id: 't', name: 'x', input: { discord_id: '1' } }],
      }),
    ).rejects.toMatchObject({ code: 'agent_harness_error', reason: 'payload_forbidden' });
    await expect(m.appendMessage(admin, CONVERSATION, { ...input, ui: { webhook_url: 'u' } })).rejects.toMatchObject({ reason: 'payload_forbidden' });
    await expect(
      m.appendMessage(admin, CONVERSATION, { role: 'user', kind: 'chat', content: [{ type: 'text', text: 'https://discord.com/api/webhooks/1/x' }] }),
    ).rejects.toMatchObject({ reason: 'payload_forbidden' });
    expect(db.calls.filter((c) => c.op !== 'select')).toHaveLength(0);
  });

  it("keeps an assistant's own words out of the scan: a reply that quotes a webhook URL or a JSON key is stored, not refused", async () => {
    const { db, m } = setup();
    ownsConversation(db);
    db.on('admin_agent_conversations', 'update', { data: { seq_head: 1 } });
    db.on('admin_agent_messages', 'insert', { data: message(1, { role: 'assistant' }) });
    const words = 'Do not paste https://discord.com/api/webhooks/1/x or a line like "discord_id": "1" into the chat.';
    const stored = await m.appendMessage(admin, CONVERSATION, {
      role: 'assistant',
      kind: 'chat',
      content: [{ type: 'text', text: words }],
      ui: { text: words, tool_calls: [{ id: 't', name: 'league_get' }] },
    });
    expect(stored.duplicate).toBe(false);
    expect(db.to('admin_agent_messages', 'insert')).toHaveLength(1);
    // The rest of the projection is still checked: a forbidden key beside the text is refused.
    await expect(
      m.appendMessage(admin, CONVERSATION, { role: 'assistant', kind: 'chat', content: [{ type: 'text', text: 'x' }], ui: { text: words, webhook_url: 'u' } }),
    ).rejects.toMatchObject({ reason: 'payload_forbidden' });
    // And the admin's own text in a projection is still scanned.
    await expect(m.appendMessage(admin, CONVERSATION, { role: 'user', kind: 'chat', content: [{ type: 'text', text: 'x' }], ui: { text: words } })).rejects.toMatchObject({
      reason: 'payload_forbidden',
    });
  });
});

describe('loadHistory / loadTail', () => {
  it('reads the messages of an owned conversation in seq order after the admin check', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    db.on('admin_agent_messages', 'select', { data: [message(1), message(2, { role: 'assistant' })] });
    const history = await m.loadHistory(admin, CONVERSATION, { afterSeq: 1 });
    expect(history.truncated).toBe(false);
    expect(history.messages.map((x) => x.seq)).toEqual([1, 2]);
    const call = db.to('admin_agent_messages', 'select')[0];
    expect(eqOf(call, 'conversation_id')).toBe(CONVERSATION);
    expect(hasStep(call, 'gt', 'seq', 1)).toBe(true);
    expect(hasStep(call, 'order', 'seq', { ascending: true })).toBe(true);
    expect(db.calls.indexOf(db.to('admin_agent_conversations')[0])).toBeLessThan(db.calls.indexOf(call));
  });

  it("never reads the messages of another admin's conversation", async () => {
    const { db, m } = setup();
    ownsConversation(db);
    await expect(m.loadHistory(other, CONVERSATION)).rejects.toMatchObject({ code: 'conversation_not_found' });
    await expect(m.loadTail(other, CONVERSATION, 5)).rejects.toMatchObject({ code: 'conversation_not_found' });
    expect(db.to('admin_agent_messages')).toHaveLength(0);
  });

  it('keeps purged messages (content null) and reports a truncated read', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    const purged = message(1, { content: null, content_purged_at: NOW.toISOString() });
    const full = Array.from({ length: 1000 }, (_, i) => (i === 0 ? purged : message(i + 1)));
    db.on('admin_agent_messages', 'select', { data: full });
    const history = await m.loadHistory(admin, CONVERSATION);
    expect(history.truncated).toBe(true);
    expect(history.messages[0].content).toBeNull();
    expect(history.messages[0].content_purged_at).not.toBeNull();
  });

  it('maps a failed page to a db error', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    db.on('admin_agent_messages', 'select', { error: { code: '57014', message: 'timeout' } });
    await expect(m.loadHistory(admin, CONVERSATION)).rejects.toMatchObject({ name: 'AdminAgentStoreDbError', operation: 'messages.loadHistory' });
  });

  it('returns the tail oldest first', async () => {
    const { db, m } = setup();
    ownsConversation(db);
    db.on('admin_agent_messages', 'select', { data: [message(9), message(8)] });
    const tail = await m.loadTail(admin, CONVERSATION, 2);
    expect(tail.map((x) => x.seq)).toEqual([8, 9]);
    expect(hasStep(db.to('admin_agent_messages')[0], 'order', 'seq', { ascending: false })).toBe(true);
    expect(hasStep(db.to('admin_agent_messages')[0], 'limit', 2)).toBe(true);
  });
});
