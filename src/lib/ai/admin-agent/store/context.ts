import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { isValidUuid } from '@/lib/utils/uuid';
import { AdminAgentStoreError, unwrap } from './errors';
import { assertAdminId, type AdminId } from './ids';

/** The service-role client. The store is the only module that holds it for `admin_agent_*` tables. */
export type AdminAgentDb = SupabaseClient<Database>;

export interface StoreContext {
  readonly db: AdminAgentDb;
  /** The clock (a test pins it). */
  readonly now: () => Date;
}

/** The conversation row every ownership check returns. */
export interface OwnedConversation {
  id: string;
  admin_id: string | null;
  admin_name: string;
  seq_head: number;
  status: string;
}

/**
 * The conversation `conversationId` when it belongs to `adminId`, else `conversation_not_found` (404 for another
 * admin's row too: existence is never confirmed). Child tables without an admin column (messages, refs, plan
 * revisions, snapshots) go through this before every read and write.
 */
export async function ownedConversation(ctx: StoreContext, adminId: AdminId, conversationId: string): Promise<OwnedConversation> {
  assertAdminId(adminId);
  if (!isValidUuid(conversationId)) throw new AdminAgentStoreError('conversation_not_found');
  const row = unwrap(
    'conversations.owned',
    await ctx.db
      .from('admin_agent_conversations')
      .select('id, admin_id, admin_name, seq_head, status')
      .eq('id', conversationId)
      .eq('admin_id', adminId)
      .maybeSingle(),
  );
  if (!row) throw new AdminAgentStoreError('conversation_not_found');
  return row;
}
