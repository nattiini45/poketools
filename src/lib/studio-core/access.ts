/**
 * Who may do what with a stored studio definition (a format or a ruleset). Pure rules, no I/O; the Format Studio
 * (`src/lib/format-studio/access.ts`) and the Ruleset Studio (`src/lib/ruleset-studio/access.ts`) bind their own meta
 * types to these functions and add their own verbs (attaching a format, using a ruleset).
 *
 * `StudioActor.isAdmin` must be a LIVE site-admin flag from a `require*` guard (never the token's copy). League and
 * tournament admins are "owners" of the definitions they created and nothing else: they see their own definitions and
 * the ones shared with all admins (`league`, `gallery`), and they edit only their own.
 *
 * - A `kind = 'preset'` row (a site catalog entry) is only ever edited by site admins.
 * - An ownerless custom row (its owner was deleted, `ON DELETE SET NULL`) is managed by site admins and usable when it
 *   is visible.
 * - A definition made for one league (`season_id` set, rulesets only) is also managed by the admins of THAT league:
 *   a guard fills `leagueIds` with the league when the actor administers it.
 * - A `gallery` definition belongs to the site: its owner cannot publish a new version of it nor move it.
 */

export const STUDIO_VISIBILITIES = ['private', 'league', 'gallery'] as const;
export type StudioVisibility = (typeof STUDIO_VISIBILITIES)[number];

export const STUDIO_KINDS = ['preset', 'custom'] as const;
export type StudioKind = (typeof STUDIO_KINDS)[number];

export interface StudioActor {
  playerId: string;
  /** Live site admin. */
  isAdmin: boolean;
  /** Leagues the actor administers, restricted to the definition under test (a guard fills at most one id). */
  leagueIds?: ReadonlySet<string>;
}

/** The columns the rules read. `season_id` is absent on formats. */
export interface DefAccess {
  kind: StudioKind;
  owner_id: string | null;
  visibility: StudioVisibility;
  season_id?: string | null;
}

function isOwner(actor: StudioActor, def: DefAccess): boolean {
  return def.owner_id !== null && def.owner_id === actor.playerId;
}

function isLeagueAdmin(actor: StudioActor, def: DefAccess): boolean {
  return def.season_id !== undefined && def.season_id !== null && actor.leagueIds?.has(def.season_id) === true;
}

function isShared(def: DefAccess): boolean {
  return def.visibility === 'league' || def.visibility === 'gallery';
}

/** Read a definition (its published versions; the draft only for those who may edit it, see `canEditDraft`). */
export function canViewDefinition(actor: StudioActor, def: DefAccess): boolean {
  return actor.isAdmin || isOwner(actor, def) || isLeagueAdmin(actor, def) || isShared(def);
}

/** Read and save the draft; also the rule for deleting. */
export function canEditDraft(actor: StudioActor, def: DefAccess): boolean {
  return actor.isAdmin || (def.kind === 'custom' && (isOwner(actor, def) || isLeagueAdmin(actor, def)));
}

/** Publish a new version. A gallery definition is published by site admins only. */
export function canPublishVersion(actor: StudioActor, def: DefAccess): boolean {
  return (
    actor.isAdmin ||
    (def.kind === 'custom' && (isOwner(actor, def) || isLeagueAdmin(actor, def)) && def.visibility !== 'gallery')
  );
}

/**
 * Change the visibility. Site admins: any change. An owner of a custom row: `private` <-> `league` only, never from or
 * to `gallery`. League admins do not change visibility.
 */
export function canSetVisibility(actor: StudioActor, def: DefAccess, next: StudioVisibility): boolean {
  if (actor.isAdmin) return true;
  if (def.kind !== 'custom' || !isOwner(actor, def)) return false;
  return def.visibility !== 'gallery' && next !== 'gallery';
}

export function canDeleteDefinition(actor: StudioActor, def: DefAccess): boolean {
  return canEditDraft(actor, def);
}
