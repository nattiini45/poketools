import 'server-only';

import { actionRepository } from './actions';
import type { AdminAgentDb, StoreContext } from './context';
import { conversationRepository } from './conversations';
import { messageRepository } from './messages';
import { planRepository } from './plans';
import { proposalRepository } from './proposals';
import { refRepository } from './refs';
import { snapshotRepository } from './snapshots';
import { usageRepository } from './usage';

/**
 * The assistant's store over a service-role client: the only code that reads or writes `admin_agent_*`. Every method
 * takes the acting admin's `AdminId` first and scopes by it. `index.ts` binds the app's client; the local-database
 * test binds its own.
 */
export function createAdminAgentStore(db: AdminAgentDb, options: { now?: () => Date } = {}) {
  const ctx: StoreContext = { db, now: options.now ?? (() => new Date()) };
  return {
    conversations: conversationRepository(ctx),
    messages: messageRepository(ctx),
    plans: planRepository(ctx),
    proposals: proposalRepository(ctx),
    actions: actionRepository(ctx),
    refs: refRepository(ctx),
    snapshots: snapshotRepository(ctx),
    usage: usageRepository(ctx),
  };
}

export type AdminAgentStore = ReturnType<typeof createAdminAgentStore>;
