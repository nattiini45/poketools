/**
 * Who may do what with a stored format definition. Pure rules, no I/O.
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
import type { FormatDefinitionMeta, FormatVisibility } from './library-types';

export interface FormatActor {
  playerId: string;
  /** Live site admin. */
  isAdmin: boolean;
}

type DefAccess = Pick<FormatDefinitionMeta, 'kind' | 'owner_id' | 'visibility'>;

function isOwner(actor: FormatActor, def: DefAccess): boolean {
  return def.owner_id !== null && def.owner_id === actor.playerId;
}

function isShared(def: DefAccess): boolean {
  return def.visibility === 'league' || def.visibility === 'gallery';
}

/** Read a definition (its published versions; the draft only for the owner and site admins, see `canEditDraft`). */
export function canViewDefinition(actor: FormatActor, def: DefAccess): boolean {
  return actor.isAdmin || isOwner(actor, def) || isShared(def);
}

/** Read and save the draft; also the rule for deleting. */
export function canEditDraft(actor: FormatActor, def: DefAccess): boolean {
  return actor.isAdmin || (def.kind === 'custom' && isOwner(actor, def));
}

/** Publish a new version. A gallery definition is published by site admins only. */
export function canPublishVersion(actor: FormatActor, def: DefAccess): boolean {
  return actor.isAdmin || (def.kind === 'custom' && isOwner(actor, def) && def.visibility !== 'gallery');
}

/**
 * Change the visibility. Site admins: any change. An owner of a custom row: `private` <-> `league` only, never from
 * or to `gallery`.
 */
export function canSetVisibility(actor: FormatActor, def: DefAccess, next: FormatVisibility): boolean {
  if (actor.isAdmin) return true;
  if (def.kind !== 'custom' || !isOwner(actor, def)) return false;
  return def.visibility !== 'gallery' && next !== 'gallery';
}

export function canDeleteDefinition(actor: FormatActor, def: DefAccess): boolean {
  return canEditDraft(actor, def);
}

/** Attach a published version to a league the actor administers. */
export function canAttachDefinition(actor: FormatActor, def: DefAccess): boolean {
  return actor.isAdmin || isOwner(actor, def) || isShared(def);
}
