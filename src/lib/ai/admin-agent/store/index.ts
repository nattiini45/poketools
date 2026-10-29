/**
 * The Admin Assistant store (plan 3.2, 3.9 test 8; spec 4.14): the only module that touches `admin_agent_*` tables.
 * Import the bound store from here; tests and the local-database suite use `createAdminAgentStore` with their own client.
 */
import 'server-only';

import { supabase } from '@/lib/supabase/client';
import { createAdminAgentStore } from './create';

export const adminAgentStore = createAdminAgentStore(supabase);

export { createAdminAgentStore } from './create';
export type { AdminAgentStore } from './create';
export type { AdminAgentDb } from './context';
export { adminIdOf, assertAdminId, isAdminId } from './ids';
export type { AdminId } from './ids';
export { AdminAgentStoreDbError, AdminAgentStoreError } from './errors';
export type { AdminAgentStoreErrorCode } from './errors';
export { findForbiddenMessageContent, findForbiddenPayload } from './payload-guard';
export type { PayloadViolation } from './payload-guard';
export { TURN_LEASE_SECONDS, turnLeaseError } from './conversations';
export type { ConversationPage, ListConversationsOptions, TurnLease } from './conversations';
export type { History, HistoryOptions } from './messages';
export { budgetExceededError, defaultUsageCaps, usageWindows } from './usage';
export type * from './types';
