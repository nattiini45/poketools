import { agentEnabledFor, parseAdminAgentEnv } from '@/lib/ai/admin-agent/env';
import { getLiveAccess } from '@/lib/auth/helpers';
import { ENABLE_ADMIN_ASSISTANT } from '@/lib/feature-flags';

/**
 * Who may see the assistant's pages (plan 5.1): the live access gate like every admin page (never the token copy), then the
 * UI flag, the server switch and the audience for this live viewer. The pages only hide a dead end; every route behind them
 * runs its own guard.
 *
 * - `denied`: not an admin, or signed out (the page hands over to `AdminGuard`, which redirects or explains).
 * - `unavailable`: an admin the assistant is not switched on for (the page answers 404 and never says why).
 */
export async function assistantPageGate(): Promise<'ok' | 'denied' | 'unavailable'> {
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return 'denied';
  const enabled =
    ENABLE_ADMIN_ASSISTANT &&
    agentEnabledFor(parseAdminAgentEnv(), { playerId: access.player.playerId, isSiteAdmin: access.isSiteAdmin, isAnyAdmin: access.isAnyAdmin });
  return enabled ? 'ok' : 'unavailable';
}
