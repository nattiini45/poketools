/**
 * The first lines of every assistant route (spec §18.9, plan 6.1): the signed-in session, a LIVE `requireAnyAdmin()`
 * (a downgraded or banned admin is refused on the next call, not after the session TTL), and then the audience check
 * `agentEnabledFor` with the live roles. A non-admin gets the guard's own 401/403; an admin the assistant is not
 * switched on for gets a 404 that never says why.
 *
 * `record: true` records the session `auth()` returned, which is what lets the dispatch layer run an existing route as
 * this admin later in the same request (chat and approve only; the read routes dispatch nothing).
 */
import type { Session } from 'next-auth';
import type { SessionPlayer } from '@/types/auth';
import { assertLocalDatabase } from '@/lib/ai/admin-agent/loop/local-guard';
import { agentEnabledFor, parseAdminAgentEnv, type AdminAgentConfig } from '@/lib/ai/admin-agent/env';
import type { ToolRole } from '@/lib/ai/admin-agent/registry';
import { adminIdOf, type AdminId } from '@/lib/ai/admin-agent/store/ids';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { authAndRecord } from '@/lib/auth/session-override';
import { agentUnavailable } from './errors';

export interface AgentAuth {
  /** The live player the guard returned (never the session copy). */
  player: SessionPlayer;
  adminId: AdminId;
  /** The tool registry the live tier selects: site admins get `site`, resource admins `scoped`. */
  role: ToolRole;
  config: AdminAgentConfig;
  /** The recorded session (only when `record` was asked for). */
  session: Session | null;
}

export async function authorizeAgent(options: { record?: boolean } = {}): Promise<AgentAuth> {
  const session = options.record === true ? await authAndRecord() : null;
  const player = await requireAnyAdmin();
  const config = parseAdminAgentEnv();
  const allowed = agentEnabledFor(config, { playerId: player.playerId, isSiteAdmin: player.isAdmin, isAnyAdmin: true });
  if (!allowed) throw agentUnavailable();
  // Every route below reads or writes `admin_agent_*` through the service-role client: a hosted database outside a
  // production build is refused here, not only where the chat route builds the agent (plan 6.2).
  assertLocalDatabase({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, nodeEnv: process.env.NODE_ENV, allowHosted: config.allowHosted });
  return { player, adminId: adminIdOf(player.playerId), role: player.isAdmin ? 'site' : 'scoped', config, session };
}
