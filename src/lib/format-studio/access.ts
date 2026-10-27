/**
 * Who may do what with a stored format definition. Pure rules, no I/O. The rules are the studio core's
 * (`src/lib/studio-core/access.ts`); this module binds them to formats and adds the one verb only formats have.
 *
 * `FormatActor.isAdmin` must be a LIVE site-admin flag from a `require*` guard (never the token's copy). League and
 * tournament admins are "owners" of the definitions they created and nothing else: they see their own definitions
 * and the ones shared with all admins (`league`, `gallery`), and they edit only their own.
 *
 * - A `kind = 'preset'` row is only ever edited by site admins.
 * - An ownerless custom row (its owner was deleted, `ON DELETE SET NULL`) is managed by site admins and attachable
 *   when it is visible.
 * - A `gallery` definition belongs to the site: its owner cannot publish a new version of it nor move it.
 */
import { canViewDefinition, type StudioActor } from '@/lib/studio-core/access';
import type { FormatDefinitionMeta } from './library-types';

export { canDeleteDefinition, canEditDraft, canPublishVersion, canSetVisibility, canViewDefinition } from '@/lib/studio-core/access';

export type FormatActor = Pick<StudioActor, 'playerId' | 'isAdmin'>;

/** Attach a published version to a league the actor administers: whoever can see the definition. */
export function canAttachDefinition(actor: FormatActor, def: Pick<FormatDefinitionMeta, 'kind' | 'owner_id' | 'visibility'>): boolean {
  return canViewDefinition(actor, def);
}
