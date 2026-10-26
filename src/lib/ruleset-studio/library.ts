/**
 * Orchestration of the ruleset library routes: create, fork, save a draft, publish, change visibility, delete, and the
 * detail read. Server only. The routes own authentication, rate limits, body reading and cache expiry; this module owns the
 * rules in between (authorization beyond the guard, the publish gate, slug handling, which columns follow the document).
 * Every function takes the live player a guard returned and the definition meta the guard read, so no function reads either
 * again. The twin of `src/lib/format-studio/library.ts`.
 *
 * Nothing here serializes a `players` row: the owner of a definition appears as `{ id, name }` only.
 */
import 'server-only';

import { resolveLText, type LText } from '@/lib/format-kit';
import { applyTourOverlay } from '@/lib/ruleset-kit/overlay';
import type { RulesetDocument } from '@/lib/ruleset-kit/types';
import { resolvePresetRules, resolveTourOverlay } from '@/lib/pkmn/preset-rules.server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { extractIdentity, hasSummary } from '@/lib/studio-core/identity';
import { newRulesetDocument, withBasedOn } from '@/lib/ruleset-studio/document';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { insertWithSlug as insertWithSlugCore, type SlugRequest } from '@/lib/studio-core/insert-with-slug.server';
import {
  countOwnedRulesetDefinitions,
  createRulesetDefinition,
  deleteRulesetDefinition,
  getLatestPublishedRulesetVersion,
  getRulesetDefinitionDraft,
  getRulesetDefinitionMeta,
  getRulesetVersion,
  listPinnedTargets,
  listRulesetVersions,
  listVersionIds,
  publishRulesetVersion,
  saveRulesetDraft,
  setRulesetVisibility,
} from '@/lib/supabase/queries/ruleset-definitions';
import { getRulesetPreset } from '@/lib/format-kit/client';
import { PRESET_RULES_VERSION } from '@/lib/pkmn/preset-data/pin';
import type { SessionPlayer } from '@/types/auth';
import type { RulesetCreateBody } from './api-schemas';
import { canEditDraft, canPublishVersion, canSetVisibility, type RulesetActor } from './access';
import { compileDocument } from './compile.server';
import { RulesetStudioError } from './errors';
import type {
  RulesetCheck,
  RulesetDefinitionDetail,
  RulesetDefinitionMeta,
  RulesetDefinitionSummary,
  RulesetKind,
  RulesetVersionSummary,
  RulesetVisibility,
} from './library-types';
import { slugFromName } from './slug';

/** Diagnostics a check returns at most; errors sort first, so they survive the cut. */
export const MAX_CHECK_DIAGNOSTICS = 200;

/** Rulesets one admin may own (the league-owned ones an attach creates are not counted). */
export const MAX_OWNED_RULESETS = 200;

export const toActor = (player: SessionPlayer, leagueIds?: ReadonlySet<string>): RulesetActor => ({
  playerId: player.playerId,
  isAdmin: player.isAdmin,
  ...(leagueIds === undefined ? {} : { leagueIds }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/** The compile of a document, as the capped check the routes return (errors first). */
export function checkDocument(document: unknown): RulesetCheck {
  const { result } = compileDocument(document);
  const sorted = [...result.diagnostics].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return {
    ok: result.ok,
    content_hash: result.content_hash,
    resolved_hash: result.resolved_hash,
    diagnostics: sorted.slice(0, MAX_CHECK_DIAGNOSTICS),
    truncated: sorted.length > MAX_CHECK_DIAGNOSTICS,
  };
}

type OwnerSummary = RulesetDefinitionSummary['owner'];
type CurrentVersionSummary = RulesetDefinitionSummary['current_version'];

/** The summary shape of a definition: no owner id, no current version id, nothing private. */
export function toSummary(
  meta: RulesetDefinitionMeta,
  owner: OwnerSummary,
  currentVersion: CurrentVersionSummary,
): RulesetDefinitionSummary {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    description: meta.description,
    kind: meta.kind,
    visibility: meta.visibility,
    season_id: meta.season_id,
    forked_from: meta.forked_from,
    draft_rev: meta.draft_rev,
    created_at: meta.created_at,
    updated_at: meta.updated_at,
    owner,
    current_version: currentVersion,
  };
}

function versionHead(version: RulesetVersionSummary | undefined, currentVersionId: string | null): CurrentVersionSummary {
  if (version === undefined || version.id !== currentVersionId) return null;
  return {
    id: version.id,
    version_no: version.version_no,
    content_hash: version.content_hash,
    created_at: version.created_at,
    catalog_version: version.catalog_version,
    base_preset: version.base_preset,
  };
}

/** The summary of a stored definition: one read for the owner's name, one for its newest version. */
export async function summariseDefinition(meta: RulesetDefinitionMeta): Promise<RulesetDefinitionSummary> {
  const [names, versions] = await Promise.all([
    meta.owner_id === null ? Promise.resolve<Record<string, string>>({}) : resolvePlayerNames([meta.owner_id]),
    meta.current_version_id === null ? Promise.resolve<RulesetVersionSummary[]>([]) : listRulesetVersions(meta.id, 1),
  ]);
  const ownerName = meta.owner_id === null ? undefined : names[meta.owner_id];
  const owner: OwnerSummary = meta.owner_id !== null && ownerName !== undefined ? { id: meta.owner_id, name: ownerName } : null;
  return toSummary(meta, owner, versionHead(versions[0], meta.current_version_id));
}

// ─── Authorization beyond the guard ──────────────────────────────────────────

/**
 * The edit rule for a definition the viewer guard let through. A `preset` row answers `ruleset_preset_locked` to anyone but
 * a site admin (an owner included); every other refusal is the plain 403 of the owner guard.
 */
export function assertCanEditDraft(actor: RulesetActor, meta: RulesetDefinitionMeta): void {
  if (canEditDraft(actor, meta)) return;
  if (meta.kind === 'preset') throw new RulesetStudioError('ruleset_preset_locked');
  throw new UserFacingError('Ruleset owner access required', { code: 'forbidden', status: 403 });
}

async function assertOwnerQuota(ownerId: string): Promise<void> {
  if ((await countOwnedRulesetDefinitions(ownerId)) >= MAX_OWNED_RULESETS) {
    throw new RulesetStudioError('ruleset_owner_quota_exceeded', { max: MAX_OWNED_RULESETS });
  }
}

// ─── Slugs ────────────────────────────────────────────────────────────────────

function isSlugTaken(error: unknown): boolean {
  return error instanceof RulesetStudioError && error.code === 'ruleset_slug_taken';
}

interface NewDefinition {
  name: LText;
  description: LText | null;
  ownerId: string | null;
  forkedFrom: string | null;
  document: Record<string, unknown>;
  kind?: RulesetKind;
  visibility?: RulesetVisibility;
  seasonId?: string | null;
}

/**
 * Inserts a definition. An explicit slug that is taken answers `ruleset_slug_taken`; a generated one retries with the
 * suffixes -2 to -9 and then four random hex digits, giving up with `ruleset_slug_taken`.
 */
function insertWithSlug(input: NewDefinition, slug: SlugRequest): Promise<RulesetDefinitionMeta> {
  return insertWithSlugCore((candidate) => createRulesetDefinition({ ...input, slug: candidate }), isSlugTaken, slug);
}

function textOf(text: LText): string {
  return resolveLText(text)?.value ?? '';
}

// ─── Create and fork ──────────────────────────────────────────────────────────

export interface CreatedRuleset {
  definition: RulesetDefinitionSummary;
  check: RulesetCheck;
}

function createdSummary(meta: RulesetDefinitionMeta, actor: SessionPlayer): RulesetDefinitionSummary {
  return toSummary(meta, { id: actor.playerId, name: actor.name }, null);
}

/**
 * Creates a private custom definition owned by the caller, from a whole document or from just a name (a blank skeleton, or a
 * copy of a catalog preset). The caller has already run `assertDocument` on a document.
 */
export async function createFromBody(actor: SessionPlayer, body: RulesetCreateBody): Promise<CreatedRuleset> {
  await assertOwnerQuota(actor.playerId);
  let document: Record<string, unknown>;
  let slugSource: string;
  let name: LText;
  let description: LText | null = null;
  if ('document' in body) {
    document = body.document;
    const identity = extractIdentity(document);
    if (identity.name === null) throw new RulesetStudioError('ruleset_document_invalid', { count: 1 });
    name = identity.name;
    description = identity.description;
    slugSource = textOf(name);
  } else {
    const fresh = newRulesetDocument(body.name, body.base_locale, body.preset);
    document = (body.tour_overlay === true && body.preset !== undefined ? withTourOverlay(fresh, body.preset) : fresh) as unknown as Record<string, unknown>;
    const identity = extractIdentity(document);
    if (identity.name === null) throw new RulesetStudioError('ruleset_document_invalid', { count: 1 });
    name = identity.name;
    slugSource = body.name;
  }
  const meta = await insertWithSlug(
    { name, description, ownerId: actor.playerId, forkedFrom: null, document },
    body.slug !== undefined ? { explicit: body.slug } : { base: slugFromName(slugSource) },
  );
  return { definition: createdSummary(meta, actor), check: checkDocument(document) };
}

/**
 * Forks a stored definition into a new private one owned by the caller. The copy is the latest PUBLISHED document; those who
 * may edit the source fork the draft when nothing is published yet, anyone else gets `ruleset_not_published`.
 */
export async function forkDefinition(
  actor: SessionPlayer,
  source: RulesetDefinitionMeta,
  mayEditSource: boolean,
  slug?: string,
): Promise<CreatedRuleset> {
  await assertOwnerQuota(actor.playerId);
  const published = await getLatestPublishedRulesetVersion(source.id);
  let base: Record<string, unknown>;
  if (published !== null) {
    base = published.spec as unknown as Record<string, unknown>;
  } else {
    const draft = mayEditSource ? await getRulesetDefinitionDraft(source.id) : null;
    if (draft === null || !isRecord(draft.document)) throw new RulesetStudioError('ruleset_not_published');
    base = draft.document;
  }
  const document = withBasedOn(base, source.slug);
  const identity = extractIdentity(document);
  const meta = await insertWithSlug(
    {
      name: identity.name ?? source.name,
      description: identity.description ?? source.description,
      ownerId: actor.playerId,
      forkedFrom: source.id,
      document,
    },
    slug !== undefined ? { explicit: slug } : { base: slugFromName(`${source.slug} copy`) },
  );
  return { definition: createdSummary(meta, actor), check: checkDocument(document) };
}

/**
 * The document with the preset's documented Smogon tour extras applied as ordinary clauses and bans. A preset without
 * extras (the routes check the flag first) is `ruleset_preset_unknown`, so a stale client cannot ask for what is not there.
 */
function withTourOverlay(document: RulesetDocument, presetId: string): RulesetDocument {
  const rules = resolvePresetRules(presetId);
  const overlay = resolveTourOverlay(presetId);
  if (rules === null || overlay === null) throw new RulesetStudioError('ruleset_preset_unknown');
  return applyTourOverlay(document, overlay, rules).document;
}

/**
 * Forks a catalog preset into a new private definition owned by the caller: the preset as the base and, with
 * `tourOverlay`, the preset's documented Smogon tour extras on top as ordinary editable entries.
 */
export async function forkPreset(
  actor: SessionPlayer,
  presetId: string,
  options: { slug?: string; tourOverlay?: boolean } = {},
): Promise<CreatedRuleset> {
  const preset = getRulesetPreset(presetId);
  if (preset === undefined) throw new RulesetStudioError('ruleset_preset_unknown');
  await assertOwnerQuota(actor.playerId);
  const fresh = newRulesetDocument(preset.name, 'en', preset.id);
  const document = (options.tourOverlay === true ? withTourOverlay(fresh, preset.id) : fresh) as unknown as Record<string, unknown>;
  const identity = extractIdentity(document);
  const meta = await insertWithSlug(
    { name: identity.name as LText, description: null, ownerId: actor.playerId, forkedFrom: null, document },
    options.slug !== undefined ? { explicit: options.slug } : { base: slugFromName(preset.id) },
  );
  return { definition: createdSummary(meta, actor), check: checkDocument(document) };
}

// ─── Detail ───────────────────────────────────────────────────────────────────

/**
 * What a viewer may see of a definition. The draft, the version list and the check are for those who may edit it (owner,
 * league admins of a league-owned ruleset, site admins); everyone else with access sees the summary and the latest published
 * document.
 */
export async function getRulesetDetail(actor: RulesetActor, meta: RulesetDefinitionMeta): Promise<RulesetDefinitionDetail> {
  const privileged = canEditDraft(actor, meta);
  const [definition, published, draft, versions] = await Promise.all([
    summariseDefinition(meta),
    getLatestPublishedRulesetVersion(meta.id),
    privileged ? getRulesetDefinitionDraft(meta.id) : Promise.resolve(null),
    privileged ? listRulesetVersions(meta.id, 100) : Promise.resolve<RulesetVersionSummary[]>([]),
  ]);
  return {
    definition,
    draft,
    published:
      published === null
        ? null
        : {
            id: published.id,
            version_no: published.version_no,
            schema_version: published.schema_version,
            name_text: published.name_text,
            base_preset: published.base_preset,
            content_hash: published.content_hash,
            resolved_hash: published.resolved_hash,
            catalog_version: published.catalog_version,
            gen: published.gen,
            format_key: published.format_key,
            is_doubles: published.is_doubles,
            changelog: published.changelog,
            created_by: published.created_by,
            created_at: published.created_at,
            spec: published.spec,
            resolved: published.resolved,
          },
    versions,
    check: draft === null ? null : checkDocument(draft.document),
  };
}

// ─── Draft ────────────────────────────────────────────────────────────────────

export interface SavedDraft {
  draft_rev: number;
  updated_at: string;
  name: LText;
  check: RulesetCheck;
}

/**
 * Saves a draft with a compare-and-set on the revision. While the definition is private, the `name` and `description`
 * columns follow the document's identity when it holds valid texts (a removed summary clears the description). A shared
 * definition keeps its columns: unpublished draft text must not reach the lists other admins read. A stale revision is a 409
 * carrying the current revision; a definition deleted in the meantime is a 404. A draft may be invalid: the response carries
 * the check.
 */
export async function saveDraft(
  meta: RulesetDefinitionMeta,
  input: { draftRev: number; document: Record<string, unknown> },
): Promise<SavedDraft> {
  const identity = extractIdentity(input.document);
  const followsIdentity = meta.visibility === 'private';
  const description = followsIdentity ? (identity.description ?? (hasSummary(input.document) ? undefined : null)) : undefined;
  const saved = await saveRulesetDraft({
    id: meta.id,
    expectedRev: input.draftRev,
    document: input.document,
    ...(followsIdentity && identity.name !== null ? { name: identity.name } : {}),
    ...(description !== undefined ? { description } : {}),
  });
  if (saved === null) {
    const current = await getRulesetDefinitionMeta(meta.id);
    if (current === null) throw new RulesetStudioError('ruleset_not_found');
    throw new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: current.draft_rev });
  }
  return {
    draft_rev: saved.draft_rev,
    updated_at: saved.updated_at,
    name: (followsIdentity ? identity.name : null) ?? meta.name,
    check: checkDocument(input.document),
  };
}

// ─── Publish ──────────────────────────────────────────────────────────────────

export interface PublishedRuleset {
  version: RulesetVersionSummary;
  definition: RulesetDefinitionSummary;
}

/**
 * Publishes the draft as the next version. Gate, in order: the publish rule (a gallery definition belongs to the site
 * admins), the draft revision the client saw (an early 409, the RPC repeats it under a row lock), the compile (any error
 * diagnostic refuses with 422 and the client reads the diagnostics from the detail route), then the RPC with the PARSED
 * document, its FROZEN resolved rules and both hashes. The RPC also refreshes the `name` and `description` columns from the
 * published document in the same transaction; the answer re-reads the row after the RPC.
 */
export async function publish(
  actor: SessionPlayer,
  meta: RulesetDefinitionMeta,
  input: { draftRev: number; changelog: LText | null },
  leagueIds?: ReadonlySet<string>,
): Promise<PublishedRuleset> {
  if (!canPublishVersion(toActor(actor, leagueIds), meta)) {
    throw new RulesetStudioError(meta.kind === 'preset' ? 'ruleset_preset_locked' : 'ruleset_published_locked');
  }
  const draft = await getRulesetDefinitionDraft(meta.id);
  if (draft === null) throw new RulesetStudioError('ruleset_not_found');
  if (draft.draft_rev !== input.draftRev) {
    throw new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: draft.draft_rev });
  }
  const { result, catalogVersion } = compileDocument(draft.document);
  if (!result.ok || result.document === null || result.resolved === null || result.content_hash === null || result.resolved_hash === null) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
    throw new RulesetStudioError('ruleset_document_invalid', { count: Math.max(errors, 1) });
  }
  const { versionNo } = await publishRulesetVersion({
    definitionId: meta.id,
    expectedRev: input.draftRev,
    spec: result.document,
    contentHash: result.content_hash,
    resolved: result.resolved,
    resolvedHash: result.resolved_hash,
    catalogVersion,
    changelog: input.changelog,
    actorId: actor.playerId,
  });
  const [stored, fresh] = await Promise.all([getRulesetVersion(meta.id, versionNo), getRulesetDefinitionMeta(meta.id)]);
  if (stored === null || fresh === null) throw new RulesetStudioError('ruleset_not_found');
  const version: RulesetVersionSummary = {
    id: stored.id,
    version_no: stored.version_no,
    schema_version: stored.schema_version,
    name_text: stored.name_text,
    content_hash: stored.content_hash,
    resolved_hash: stored.resolved_hash,
    catalog_version: stored.catalog_version,
    base_preset: stored.base_preset,
    gen: stored.gen,
    format_key: stored.format_key,
    is_doubles: stored.is_doubles,
    changelog: stored.changelog,
    created_by: stored.created_by,
    created_at: stored.created_at,
  };
  return { version, definition: await summariseDefinition(fresh) };
}

/**
 * Publishes a document that no person edited as version 1 of a NEW definition: the rulesets a format attach creates for a
 * league's rule-preset stages, and the seeded site rulesets. Compiles first and throws `ruleset_document_invalid` on an error.
 * Returns the definition id and the id of its only version (what a phase pins). A failed publish deletes the new definition,
 * so no draft-only row stays behind.
 */
export async function createPublished(input: {
  name: LText;
  slugBase: string;
  document: Record<string, unknown>;
  ownerId: string | null;
  kind: RulesetKind;
  visibility: RulesetVisibility;
  seasonId: string | null;
  changelog: LText | null;
}): Promise<{ definitionId: string; versionId: string }> {
  const { result, catalogVersion } = compileDocument(input.document);
  if (!result.ok || result.document === null || result.resolved === null || result.content_hash === null || result.resolved_hash === null) {
    throw new RulesetStudioError('ruleset_document_invalid', { count: Math.max(result.diagnostics.filter((d) => d.severity === 'error').length, 1) });
  }
  const meta = await insertWithSlug(
    {
      name: input.name,
      description: null,
      ownerId: input.ownerId,
      forkedFrom: null,
      document: input.document,
      kind: input.kind,
      visibility: input.visibility,
      seasonId: input.seasonId,
    },
    { base: slugFromName(input.slugBase) },
  );
  try {
    const { versionId } = await publishRulesetVersion({
      definitionId: meta.id,
      expectedRev: meta.draft_rev,
      spec: result.document,
      contentHash: result.content_hash,
      resolved: result.resolved,
      resolvedHash: result.resolved_hash,
      catalogVersion: catalogVersion ?? PRESET_RULES_VERSION,
      changelog: input.changelog,
      actorId: input.ownerId,
    });
    return { definitionId: meta.id, versionId };
  } catch (err) {
    await deleteRulesetDefinition(meta.id).catch((cleanup: unknown) => {
      console.error(`[ruleset-library] could not discard definition ${meta.id} after a failed publish`, cleanup);
    });
    throw err;
  }
}

// ─── Visibility and delete ────────────────────────────────────────────────────

/**
 * Changes who can see a definition. The visibility rule decides first (`ruleset_preset_locked` for a site ruleset,
 * `ruleset_visibility_forbidden` otherwise); sharing with `league` or `gallery` needs a published version.
 */
export async function changeVisibility(
  actor: SessionPlayer,
  meta: RulesetDefinitionMeta,
  next: RulesetVisibility,
): Promise<RulesetDefinitionSummary> {
  if (!canSetVisibility(toActor(actor), meta, next)) {
    throw new RulesetStudioError(meta.kind === 'preset' ? 'ruleset_preset_locked' : 'ruleset_visibility_forbidden');
  }
  if (next !== 'private' && meta.current_version_id === null) throw new RulesetStudioError('ruleset_not_published');
  const updated = await setRulesetVisibility(meta.id, next);
  return summariseDefinition(updated);
}

/**
 * Deletes a definition that no league or phase pins. A pinned version is history a league relies on: the refusal is
 * `ruleset_in_use` with the number of pins. A definition that was never published, or whose versions nothing pins, can go.
 * The database refuses the delete as well (a pinned version cannot be removed), so a pin created between the count and the
 * delete still answers `ruleset_in_use`.
 */
export async function removeDefinition(
  actor: RulesetActor,
  meta: RulesetDefinitionMeta,
): Promise<void> {
  assertCanEditDraft(actor, meta);
  const pinned = await listPinnedTargets(await listVersionIds(meta.id));
  const count = pinned.seasons.length + pinned.tournaments.length;
  if (count > 0) throw new RulesetStudioError('ruleset_in_use', { count });
  await deleteRulesetDefinition(meta.id);
}
