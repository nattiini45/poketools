/**
 * Provenance of write arguments (plan 4.5): the ids a conversation has legitimately seen. Every uuid in a staged call
 * must be in this set (or be a `$ref`), so an id invented by the model or found inside poisoned text is
 * `unknown_reference`. Sources: a uuid the admin typed, a structured id field of a typed tool result, a proposal step
 * result.
 *
 * Rows are insert-only (the update trigger allows no change), so recording is `ON CONFLICT DO NOTHING`: the first
 * label and source of a ref stay.
 */
import { isValidUuid } from '@/lib/utils/uuid';
import { REF_COLUMNS } from './columns';
import { ownedConversation, type StoreContext } from './context';
import { unwrap } from './errors';
import { assertAdminId, type AdminId } from './ids';
import type { NewRef, RefRecord } from './types';

export const REF_BATCH_MAX = 200;
const LABEL_MAX = 300;
const KIND_MAX = 64;
const IN_CHUNK = 100;
export const REF_LIST_MAX = 1000;

export function refRepository(ctx: StoreContext) {
  return {
    /** Records refs seen in this conversation (at most 200 per call); ones already known are left as they are. Invalid ids are skipped. */
    async recordRefs(adminId: AdminId, conversationId: string, refs: readonly NewRef[]): Promise<number> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      const seen = new Set<string>();
      const rows = [];
      for (const ref of refs.slice(0, REF_BATCH_MAX)) {
        const id = ref.id.toLowerCase();
        const key = `${ref.kind}:${id}`;
        if (!isValidUuid(id) || ref.kind.length < 1 || ref.kind.length > KIND_MAX || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          conversation_id: conversationId,
          ref_kind: ref.kind,
          ref_id: id,
          label: ref.label ? ref.label.slice(0, LABEL_MAX) : null,
          source: ref.source,
        });
      }
      if (rows.length === 0) return 0;
      unwrap(
        'refs.record',
        await ctx.db.from('admin_agent_refs').upsert(rows, { onConflict: 'conversation_id,ref_kind,ref_id', ignoreDuplicates: true }),
      );
      return rows.length;
    },

    /** The subset of `ids` this conversation has seen (any kind): the provenance check of a staged call. */
    async knownRefIds(adminId: AdminId, conversationId: string, ids: readonly string[]): Promise<Set<string>> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      const wanted = [...new Set(ids.map((id) => id.toLowerCase()).filter(isValidUuid))];
      const known = new Set<string>();
      for (let i = 0; i < wanted.length; i += IN_CHUNK) {
        const rows = unwrap(
          'refs.known',
          await ctx.db
            .from('admin_agent_refs')
            .select('ref_id')
            .eq('conversation_id', conversationId)
            .in('ref_id', wanted.slice(i, i + IN_CHUNK)),
        );
        for (const row of rows ?? []) known.add(row.ref_id);
      }
      return known;
    },

    /** The conversation's refs, newest first, optionally of one kind (up to 1,000). */
    async listRefs(adminId: AdminId, conversationId: string, kind?: string): Promise<RefRecord[]> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      let query = ctx.db.from('admin_agent_refs').select(REF_COLUMNS).eq('conversation_id', conversationId);
      if (kind !== undefined) query = query.eq('ref_kind', kind);
      return unwrap('refs.list', await query.order('seen_at', { ascending: false }).order('ref_id', { ascending: true }).limit(REF_LIST_MAX)) ?? [];
    },
  };
}

export type RefRepository = ReturnType<typeof refRepository>;
