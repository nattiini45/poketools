/**
 * The append-only transcript. History is loaded by conversation id after the admin check (plan 3.4); the browser
 * never sends history.
 *
 * `seq` comes from `admin_agent_conversations.seq_head`, advanced by a compare-and-set before the row is inserted, so two
 * appenders can never take the same number even without the turn lease (the lease only keeps two turns apart; the
 * primary key `(conversation_id, seq)` is the second line of defence). A failed insert after the advance leaves a gap
 * in `seq`; readers order by `seq` and never rely on contiguity. `client_msg_id` makes a retried POST idempotent.
 */
import { MESSAGE_COLUMNS } from './columns';
import { ownedConversation, type StoreContext } from './context';
import { AdminAgentStoreDbError, isUniqueViolation, mapStoreDbError, unwrap } from './errors';
import { assertAdminId, type AdminId } from './ids';
import { assertMessageContentAllowed, assertPayloadAllowed } from './payload-guard';
import { readBoundedPages } from '@/lib/supabase/read-bounded-pages';
import type { AppendedMessage, MessageRecord, NewMessage } from './types';

const CLIENT_MSG_INDEX = 'uq_admin_agent_messages_client_msg';
const MAX_APPEND_ATTEMPTS = 10;
/** Pages of 1,000 messages a history read walks before it reports `truncated`. */
const HISTORY_MAX_PAGES = 10;
export const TAIL_MAX = 200;

/** A UI projection without its `text` (the assistant's own words), for the payload scan. */
function withoutText(ui: NonNullable<NewMessage['ui']>): NonNullable<NewMessage['ui']> {
  if (typeof ui !== 'object' || ui === null || Array.isArray(ui)) return ui;
  const { text: _text, ...rest } = ui as Record<string, unknown>;
  return rest as NonNullable<NewMessage['ui']>;
}

export interface HistoryOptions {
  /** Only messages with a larger `seq` (default 0: from the start). */
  afterSeq?: number;
}

export interface History {
  messages: MessageRecord[];
  /** True when the history is longer than the read bound; the loop then refuses the turn (start a new conversation). */
  truncated: boolean;
}

export function messageRepository(ctx: StoreContext) {
  async function findByClientId(adminId: AdminId, conversationId: string, clientMsgId: string): Promise<MessageRecord | null> {
    return unwrap(
      'messages.findByClientId',
      await ctx.db
        .from('admin_agent_messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId)
        .eq('client_msg_id', clientMsgId)
        .maybeSingle(),
    );
  }

  return {
    /**
     * Appends one message and returns it with its `seq`. A `clientMsgId` already stored for this conversation returns
     * that message with `duplicate: true` and writes nothing. Content that carries a forbidden key or a webhook URL
     * (payload-guard.ts) is refused before anything is written.
     */
    async appendMessage(adminId: AdminId, conversationId: string, input: NewMessage): Promise<AppendedMessage> {
      assertAdminId(adminId);
      const conversation = await ownedConversation(ctx, adminId, conversationId);
      assertMessageContentAllowed(input.role, input.content);
      // The UI projection of an assistant message repeats the model's own text, which is never scanned (payload-guard.ts):
      // a reply that quotes a webhook-shaped URL must not lose a paid step.
      if (input.ui) assertPayloadAllowed('message.ui', input.role === 'assistant' ? withoutText(input.ui) : input.ui);

      if (input.clientMsgId) {
        const existing = await findByClientId(adminId, conversationId, input.clientMsgId);
        if (existing) return { message: existing, duplicate: true };
      }

      let head = conversation.seq_head;
      for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
        const next = head + 1;
        const advanced = unwrap(
          'messages.advanceSeq',
          await ctx.db
            .from('admin_agent_conversations')
            .update({ seq_head: next, last_message_at: ctx.now().toISOString() })
            .eq('id', conversationId)
            .eq('admin_id', adminId)
            .eq('seq_head', head)
            .select('seq_head')
            .maybeSingle(),
        );
        if (!advanced) {
          // Another appender moved the head: read it again and retry from there.
          head = (await ownedConversation(ctx, adminId, conversationId)).seq_head;
          continue;
        }
        const { data, error } = await ctx.db
          .from('admin_agent_messages')
          .insert({
            conversation_id: conversationId,
            seq: next,
            role: input.role,
            kind: input.kind,
            content: input.content,
            ui: input.ui ?? null,
            model: input.model ?? null,
            stop_reason: input.stopReason ?? null,
            usage: input.usage ?? null,
            client_msg_id: input.clientMsgId ?? null,
          })
          .select(MESSAGE_COLUMNS)
          .single();
        if (!error) return { message: data, duplicate: false };
        if (input.clientMsgId && isUniqueViolation(error, CLIENT_MSG_INDEX)) {
          const existing = await findByClientId(adminId, conversationId, input.clientMsgId);
          if (existing) return { message: existing, duplicate: true };
        }
        if (isUniqueViolation(error)) {
          // The number was taken by a row we did not see; start again above it.
          head = next;
          continue;
        }
        throw mapStoreDbError('messages.insert', error);
      }
      throw new AdminAgentStoreDbError('messages.append', new Error('could not take a sequence number'));
    },

    /** The whole transcript in `seq` order (content of purged messages is `null`; see `content_purged_at`). */
    async loadHistory(adminId: AdminId, conversationId: string, options: HistoryOptions = {}): Promise<History> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      const afterSeq = options.afterSeq ?? 0;
      const { rows, truncated } = await readBoundedPages<MessageRecord>(
        (from, to) =>
          ctx.db
            .from('admin_agent_messages')
            .select(MESSAGE_COLUMNS)
            .eq('conversation_id', conversationId)
            .gt('seq', afterSeq)
            .order('seq', { ascending: true })
            .range(from, to),
        { label: 'admin-agent history', maxPages: HISTORY_MAX_PAGES },
      ).catch((error: unknown) => {
        throw mapStoreDbError('messages.loadHistory', error);
      });
      return { messages: rows, truncated };
    },

    /** The last `limit` messages (1 to 200) in `seq` order: enough to see whether a harness event is unconsumed. */
    async loadTail(adminId: AdminId, conversationId: string, limit: number): Promise<MessageRecord[]> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      const count = Math.min(Math.max(Math.trunc(limit), 1), TAIL_MAX);
      const rows = unwrap(
        'messages.loadTail',
        await ctx.db
          .from('admin_agent_messages')
          .select(MESSAGE_COLUMNS)
          .eq('conversation_id', conversationId)
          .order('seq', { ascending: false })
          .limit(count),
      );
      return [...(rows ?? [])].reverse();
    },
  };
}

export type MessageRepository = ReturnType<typeof messageRepository>;
