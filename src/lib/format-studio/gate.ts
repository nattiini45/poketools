import 'server-only';

/**
 * Live view gate of the stored-format pages (`/admin/formats/[id]` and its editor). The decision comes from the
 * live player and the definition row, never from the session token, and no draft body is read here:
 *
 * - a malformed or unknown id is a 404 (`notFound()`), before any admin read for a malformed id;
 * - signed out, not an admin, banned or suspended (a site admin always passes): `guard`, which renders
 *   `AdminGuard`;
 * - an admin who may not see this definition (another admin's private format): `forbidden`;
 * - otherwise `ok`, with `canEdit` from the same rule the draft route uses (`canEditDraft`).
 *
 * League and tournament admins only ever reach their own definitions and the ones shared with all admins.
 */
import { notFound } from 'next/navigation';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getFormatDefinitionMeta } from '@/lib/supabase/queries/format-definitions';
import type { SessionPlayer } from '@/types/auth';
import { isValidUuid } from '@/lib/utils/uuid';
import { canEditDraft, canViewDefinition, type FormatActor } from './access';
import type { FormatDefinitionMeta } from './library-types';

export type FormatPageGate =
  /** Signed out or not an admin: render `AdminGuard`. */
  | { kind: 'guard' }
  /** An admin who may not view this definition: render `ResourceForbidden`. */
  | { kind: 'forbidden' }
  | { kind: 'ok'; player: SessionPlayer; actor: FormatActor; definition: FormatDefinitionMeta; canEdit: boolean };

export async function gateFormatDefinition(id: string): Promise<FormatPageGate> {
  if (!isValidUuid(id)) notFound();
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return { kind: 'guard' };

  const player = access.player;
  const actor: FormatActor = { playerId: player.playerId, isAdmin: access.isSiteAdmin };
  const definition = await getFormatDefinitionMeta(id);
  if (definition === null) notFound();
  if (!canViewDefinition(actor, definition)) return { kind: 'forbidden' };
  return { kind: 'ok', player, actor, definition, canEdit: canEditDraft(actor, definition) };
}
