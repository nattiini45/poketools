import 'server-only';

/**
 * Live view gate of the stored-ruleset pages (`/admin/rulesets/[id]` and its editor). The decision comes from the live
 * player and the definition row, never from the session token, and no draft body is read here:
 *
 * - a malformed or unknown id is a 404 (`notFound()`), before any admin read for a malformed id;
 * - signed out, not an admin, banned or suspended (a site admin always passes): `guard`, which renders `AdminGuard`;
 * - an admin who may not see this definition (another admin's private ruleset): `forbidden`;
 * - otherwise `ok`, with `canEdit` from the same rule the draft route uses (`canEditDraft`).
 *
 * The admins of the league that owns a league-owned ruleset are found with one extra read, only for such rows.
 */
import { notFound } from 'next/navigation';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getRulesetDefinitionMeta } from '@/lib/supabase/queries/ruleset-definitions';
import type { SessionPlayer } from '@/types/auth';
import { isValidUuid } from '@/lib/utils/uuid';
import { canEditDraft, canViewDefinition, type RulesetActor } from './access';
import { actorFor } from './guards';
import type { RulesetDefinitionMeta } from './library-types';

export type RulesetPageGate =
  /** Signed out or not an admin: render `AdminGuard`. */
  | { kind: 'guard' }
  /** An admin who may not view this definition: render `ResourceForbidden`. */
  | { kind: 'forbidden' }
  | { kind: 'ok'; player: SessionPlayer; actor: RulesetActor; definition: RulesetDefinitionMeta; canEdit: boolean };

export async function gateRulesetDefinition(id: string): Promise<RulesetPageGate> {
  if (!isValidUuid(id)) notFound();
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return { kind: 'guard' };

  const player = access.player;
  const definition = await getRulesetDefinitionMeta(id);
  if (definition === null) notFound();
  const actor = await actorFor({ ...player, isAdmin: access.isSiteAdmin }, definition);
  if (!canViewDefinition(actor, definition)) return { kind: 'forbidden' };
  return { kind: 'ok', player, actor, definition, canEdit: canEditDraft(actor, definition) };
}
