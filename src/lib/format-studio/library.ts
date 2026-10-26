/**
 * Orchestration of the format library routes: create, fork, save a draft, publish, change visibility, delete,
 * and the detail read. Server only. The routes own authentication, rate limits, body reading and cache expiry;
 * this module owns the rules in between (authorization beyond the guard, the publish gate, slug handling,
 * which columns follow the document). Every function takes the live player a guard returned and the definition
 * meta the guard read, so no function reads either again.
 *
 * Nothing here serializes a `players` row: the owner of a definition appears as `{ id, name }` only.
 */
import 'server-only';

import {
  CURRENT_ENV,
  PRESETS,
  applyRulesetPreset,
  compile,
  isSlug,
  resolveLText,
  type Diagnostic,
  type LText,
} from '@/lib/format-kit';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  countFormatVersions,
  countSeasonFormatsOfDefinition,
  createFormatDefinition,
  deleteFormatDefinition,
  getFormatDefinitionDraft,
  getFormatDefinitionMeta,
  getFormatVersion,
  getLatestPublishedVersion,
  listFormatVersions,
  publishFormatVersion,
  saveFormatDraft,
  setFormatVisibility,
} from '@/lib/supabase/queries/format-definitions';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { extractIdentity, hasSummary } from '@/lib/studio-core/identity';
import { insertWithSlug as insertWithSlugCore, type SlugRequest } from '@/lib/studio-core/insert-with-slug.server';
import type { SessionPlayer } from '@/types/auth';
import type { FormatCreateBody } from './api-schemas';
import { canEditDraft, canPublishVersion, canSetVisibility, type FormatActor } from './access';
import { FormatStudioError } from './errors';
import { skeletonDocument } from './document';
import type {
  FormatCheck,
  FormatDefinitionDetail,
  FormatDefinitionMeta,
  FormatDefinitionSummary,
  FormatVersionSummary,
  FormatVisibility,
} from './library-types';
import { slugFromName } from './slug';

/** Diagnostics a check returns at most; errors sort first, so they survive the cut. */
export const MAX_CHECK_DIAGNOSTICS = 200;

export const toActor = (player: SessionPlayer): FormatActor => ({ playerId: player.playerId, isAdmin: player.isAdmin });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The compile of a document against the current environment, as the capped check the routes return. */
export function checkDocument(document: unknown): FormatCheck {
  const result = compile(document, CURRENT_ENV);
  const diagnostics: Diagnostic[] = result.diagnostics.slice(0, MAX_CHECK_DIAGNOSTICS);
  return {
    ok: result.ok,
    hash: result.hash,
    diagnostics,
    truncated: result.diagnostics.length > MAX_CHECK_DIAGNOSTICS,
  };
}

type OwnerSummary = FormatDefinitionSummary['owner'];
type CurrentVersionSummary = FormatDefinitionSummary['current_version'];

/** The summary shape of a definition: no owner id, no current version id, nothing private. */
export function toSummary(
  meta: FormatDefinitionMeta,
  owner: OwnerSummary,
  currentVersion: CurrentVersionSummary,
): FormatDefinitionSummary {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    description: meta.description,
    kind: meta.kind,
    visibility: meta.visibility,
    forked_from: meta.forked_from,
    draft_rev: meta.draft_rev,
    created_at: meta.created_at,
    updated_at: meta.updated_at,
    owner,
    current_version: currentVersion,
  };
}

function versionHead(version: FormatVersionSummary | undefined, currentVersionId: string | null): CurrentVersionSummary {
  if (version === undefined || version.id !== currentVersionId) return null;
  return { id: version.id, version_no: version.version_no, content_hash: version.content_hash, created_at: version.created_at };
}

/** The summary of a stored definition: one read for the owner's name, one for its newest version. */
export async function summariseDefinition(meta: FormatDefinitionMeta): Promise<FormatDefinitionSummary> {
  const [names, versions] = await Promise.all([
    meta.owner_id === null ? Promise.resolve<Record<string, string>>({}) : resolvePlayerNames([meta.owner_id]),
    meta.current_version_id === null ? Promise.resolve<FormatVersionSummary[]>([]) : listFormatVersions(meta.id, 1),
  ]);
  const ownerName = meta.owner_id === null ? undefined : names[meta.owner_id];
  const owner: OwnerSummary = meta.owner_id !== null && ownerName !== undefined ? { id: meta.owner_id, name: ownerName } : null;
  return toSummary(meta, owner, versionHead(versions[0], meta.current_version_id));
}

// ─── Authorization beyond the guard ──────────────────────────────────────────

/**
 * The edit rule for a definition the viewer guard let through. A `preset` row answers `format_preset_locked`
 * to anyone but a site admin (an owner included); every other refusal is the plain 403 of the owner guard.
 */
export function assertCanEditDraft(actor: SessionPlayer, meta: FormatDefinitionMeta): void {
  if (canEditDraft(toActor(actor), meta)) return;
  if (meta.kind === 'preset') throw new FormatStudioError('format_preset_locked');
  throw new UserFacingError('Format owner access required', { code: 'forbidden', status: 403 });
}

// ─── Slugs ────────────────────────────────────────────────────────────────────

function isSlugTaken(error: unknown): boolean {
  return error instanceof FormatStudioError && error.code === 'format_slug_taken';
}

interface NewDefinition {
  name: LText;
  description: LText | null;
  ownerId: string;
  forkedFrom: string | null;
  document: Record<string, unknown>;
}

/**
 * Inserts a definition. An explicit slug that is taken answers `format_slug_taken`; a generated one retries with
 * the suffixes -2 to -9 and then four random hex digits, giving up with `format_slug_taken`.
 */
function insertWithSlug(input: NewDefinition, slug: SlugRequest): Promise<FormatDefinitionMeta> {
  return insertWithSlugCore((candidate) => createFormatDefinition({ ...input, slug: candidate }), isSlugTaken, slug);
}

function textOf(text: LText): string {
  return resolveLText(text)?.value ?? '';
}

// ─── Create and fork ──────────────────────────────────────────────────────────

export interface CreatedFormat {
  definition: FormatDefinitionSummary;
  check: FormatCheck;
}

function createdSummary(meta: FormatDefinitionMeta, actor: SessionPlayer): FormatDefinitionSummary {
  return toSummary(meta, { id: actor.playerId, name: actor.name }, null);
}

/**
 * Creates a private custom definition owned by the caller, from a whole document or from just a name (a
 * skeleton the check reports as incomplete). The caller has already run `assertDocument` on a document.
 */
export async function createFromBody(actor: SessionPlayer, body: FormatCreateBody): Promise<CreatedFormat> {
  let document: Record<string, unknown>;
  let slugSource: string;
  let name: LText;
  let description: LText | null = null;
  if ('document' in body) {
    document = body.document;
    const identity = extractIdentity(document);
    if (identity.name === null) throw new FormatStudioError('format_document_name_required');
    name = identity.name;
    description = identity.description;
    slugSource = textOf(name);
  } else {
    document = skeletonDocument(body.name, body.base_locale);
    const identity = extractIdentity(document);
    // The envelope already refuses unstorable characters; this keeps a null name from ever reaching the insert.
    if (identity.name === null) throw new FormatStudioError('format_document_name_required');
    name = identity.name;
    slugSource = body.name;
  }
  const meta = await insertWithSlug(
    { name, description, ownerId: actor.playerId, forkedFrom: null, document },
    body.slug !== undefined ? { explicit: body.slug } : { base: slugFromName(slugSource) },
  );
  return { definition: createdSummary(meta, actor), check: checkDocument(document) };
}

/** A copy of a document with `identity.based_on` set (the identity block is created when the draft lacks one). */
function withBasedOn(document: Record<string, unknown>, basedOn: string): Record<string, unknown> {
  const copy = structuredClone(document);
  const identity = isRecord(copy.identity) ? copy.identity : {};
  return { ...copy, identity: { ...identity, based_on: basedOn } };
}

/**
 * Forks a stored definition into a new private one owned by the caller. The copy is the latest PUBLISHED spec;
 * the owner and site admins fork the draft when nothing is published yet, anyone else gets `format_not_published`.
 */
export async function forkDefinition(actor: SessionPlayer, source: FormatDefinitionMeta, slug?: string): Promise<CreatedFormat> {
  const published = await getLatestPublishedVersion(source.id);
  let base: Record<string, unknown>;
  if (published !== null) {
    base = published.spec as unknown as Record<string, unknown>;
  } else {
    const privileged = actor.isAdmin || source.owner_id === actor.playerId;
    const draft = privileged ? await getFormatDefinitionDraft(source.id) : null;
    if (draft === null || !isRecord(draft.document)) throw new FormatStudioError('format_not_published');
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

export interface ForkPresetOptions {
  slug?: string;
  /** A catalog id: pre-picked on every stage of the copy, and the preset name is appended to the copy's name. */
  rulesetPreset?: string;
}

/**
 * Forks a shipped example (the code presets) into a new private definition owned by the caller. With a rule preset
 * the copy has it pre-picked on every stage (`applyRulesetPreset`), the preset in its name and its slug.
 */
export async function forkPreset(actor: SessionPlayer, presetId: string, options: ForkPresetOptions = {}): Promise<CreatedFormat> {
  const { slug, rulesetPreset } = options;
  const preset = isSlug(presetId) ? PRESETS.find((entry) => entry.id === presetId) : undefined;
  if (preset === undefined) throw new FormatStudioError('format_preset_not_found');
  const structure = rulesetPreset === undefined ? preset.definition : applyRulesetPreset(preset.definition, rulesetPreset, { retitle: true });
  const document = withBasedOn(structure as unknown as Record<string, unknown>, preset.id);
  const identity = extractIdentity(document);
  const meta = await insertWithSlug(
    {
      name: identity.name as LText,
      description: identity.description,
      ownerId: actor.playerId,
      forkedFrom: null,
      document,
    },
    slug !== undefined ? { explicit: slug } : { base: slugFromName(rulesetPreset === undefined ? preset.id : `${preset.id}-${rulesetPreset}`) },
  );
  return { definition: createdSummary(meta, actor), check: checkDocument(document) };
}

// ─── Detail ───────────────────────────────────────────────────────────────────

/**
 * What a viewer may see of a definition. The draft, the version list and the check are for the owner and site
 * admins; everyone else with access sees the summary and the latest published spec.
 */
export async function getFormatDetail(actor: SessionPlayer, meta: FormatDefinitionMeta): Promise<FormatDefinitionDetail> {
  const privileged = actor.isAdmin || meta.owner_id === actor.playerId;
  const [definition, published, draft, versions] = await Promise.all([
    summariseDefinition(meta),
    getLatestPublishedVersion(meta.id),
    privileged ? getFormatDefinitionDraft(meta.id) : Promise.resolve(null),
    privileged ? listFormatVersions(meta.id, 100) : Promise.resolve<FormatVersionSummary[]>([]),
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
            content_hash: published.content_hash,
            changelog: published.changelog,
            created_by: published.created_by,
            created_at: published.created_at,
            spec: published.spec,
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
  check: FormatCheck;
}

/**
 * Saves a draft with a compare-and-set on the revision. While the definition is private, the `name` and
 * `description` columns follow the document's identity when it holds valid texts (a removed summary clears the
 * description). A definition shared with other admins keeps its columns: unpublished draft text must not reach
 * the lists and the gallery shelf other admins read. A stale revision is a 409 carrying the current revision; a
 * definition deleted in the meantime is a 404. A draft may be invalid: the response carries the check.
 */
export async function saveDraft(
  meta: FormatDefinitionMeta,
  input: { draftRev: number; document: Record<string, unknown> },
): Promise<SavedDraft> {
  const identity = extractIdentity(input.document);
  const followsIdentity = meta.visibility === 'private';
  const description = followsIdentity ? (identity.description ?? (hasSummary(input.document) ? undefined : null)) : undefined;
  const saved = await saveFormatDraft({
    id: meta.id,
    expectedRev: input.draftRev,
    document: input.document,
    ...(followsIdentity && identity.name !== null ? { name: identity.name } : {}),
    ...(description !== undefined ? { description } : {}),
  });
  if (saved === null) {
    const current = await getFormatDefinitionMeta(meta.id);
    if (current === null) throw new FormatStudioError('format_not_found');
    throw new FormatStudioError('format_stale_revision', undefined, { draft_rev: current.draft_rev });
  }
  return {
    draft_rev: saved.draft_rev,
    updated_at: saved.updated_at,
    name: (followsIdentity ? identity.name : null) ?? meta.name,
    check: checkDocument(input.document),
  };
}

// ─── Publish ──────────────────────────────────────────────────────────────────

export interface PublishedFormat {
  version: FormatVersionSummary;
  definition: FormatDefinitionSummary;
}

/**
 * Publishes the draft as the next version. Gate, in order: the publish rule (a gallery definition belongs to the
 * site admins), the draft revision the client saw (an early 409, the RPC repeats it under a row lock), the kit
 * compile (any error diagnostic refuses with 422 and the client reads the diagnostics from the detail route),
 * then the RPC with the PARSED definition and its canonical hash. The RPC also sets the `name` and `description`
 * columns from the published spec's identity in the same transaction (a shared definition's draft saves leave them
 * alone, so this is the write that refreshes what the lists show); the answer re-reads the row after the RPC, so it
 * carries the refreshed columns, and the route expires the gallery shelf.
 */
export async function publish(
  actor: SessionPlayer,
  meta: FormatDefinitionMeta,
  input: { draftRev: number; changelog: LText | null },
): Promise<PublishedFormat> {
  if (!canPublishVersion(toActor(actor), meta)) {
    throw new FormatStudioError(meta.kind === 'preset' ? 'format_preset_locked' : 'format_published_locked');
  }
  const draft = await getFormatDefinitionDraft(meta.id);
  if (draft === null) throw new FormatStudioError('format_not_found');
  if (draft.draft_rev !== input.draftRev) {
    throw new FormatStudioError('format_stale_revision', undefined, { draft_rev: draft.draft_rev });
  }
  const result = compile(draft.document, CURRENT_ENV);
  if (!result.ok || result.definition === null || result.hash === null) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
    throw new FormatStudioError('format_publish_invalid', { count: Math.max(errors, 1) });
  }
  const { versionNo } = await publishFormatVersion({
    definitionId: meta.id,
    expectedRev: input.draftRev,
    specJson: result.definition,
    contentHash: result.hash,
    changelog: input.changelog,
    actorId: actor.playerId,
  });
  const [stored, fresh] = await Promise.all([getFormatVersion(meta.id, versionNo), getFormatDefinitionMeta(meta.id)]);
  if (stored === null || fresh === null) throw new FormatStudioError('format_not_found');
  const version: FormatVersionSummary = {
    id: stored.id,
    version_no: stored.version_no,
    schema_version: stored.schema_version,
    content_hash: stored.content_hash,
    changelog: stored.changelog,
    created_by: stored.created_by,
    created_at: stored.created_at,
  };
  return { version, definition: await summariseDefinition(fresh) };
}

// ─── Visibility and delete ────────────────────────────────────────────────────

/**
 * Changes who can see a definition. The visibility rule decides first (`format_preset_locked` for a preset row,
 * `format_visibility_forbidden` otherwise); sharing with `league` or `gallery` needs a published version.
 */
export async function changeVisibility(
  actor: SessionPlayer,
  meta: FormatDefinitionMeta,
  next: FormatVisibility,
): Promise<FormatDefinitionSummary> {
  if (!canSetVisibility(toActor(actor), meta, next)) {
    throw new FormatStudioError(meta.kind === 'preset' ? 'format_preset_locked' : 'format_visibility_forbidden');
  }
  if (next !== 'private' && meta.current_version_id === null) throw new FormatStudioError('format_not_published');
  const updated = await setFormatVisibility(meta.id, next);
  return summariseDefinition(updated);
}

/**
 * Deletes a definition that was never published and is attached nowhere (a published version is history a
 * league may rely on; an archive state comes later).
 */
export async function removeDefinition(actor: SessionPlayer, meta: FormatDefinitionMeta): Promise<void> {
  // Deleting follows the edit rule (`canDeleteDefinition` equals `canEditDraft`).
  assertCanEditDraft(actor, meta);
  const attached = await countSeasonFormatsOfDefinition(meta.id);
  if (attached > 0) throw new FormatStudioError('format_attached', { count: attached });
  if ((await countFormatVersions(meta.id)) > 0) throw new FormatStudioError('format_has_versions');
  await deleteFormatDefinition(meta.id);
}
