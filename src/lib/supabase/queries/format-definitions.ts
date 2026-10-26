/**
 * Queries behind the format library (`format_definitions`, `format_definition_versions`). Server only.
 *
 * Every read names its columns: the draft body (`current_draft`) is selected only by `getFormatDefinitionDraft`,
 * never by a list or a guard read. Lists are bounded (`.range()` plus an exact count, at most 100 rows), the
 * version list is capped at 100, and no user text ever reaches a filter string: the one `.or()` quotes the player id
 * with `postgrestQuoted`. Database signals (slug taken, document too large to store, publish races) leave this module
 * as `FormatStudioError` through `mapFormatDbError`.
 *
 * The routes check access first (`requireFormatOwner` / `requireFormatViewer`, `src/lib/format-studio/access.ts`);
 * these functions run as the service role and enforce nothing themselves.
 */
import 'server-only';

import { supabase } from '../client';
import { postgrestQuoted } from '../postgrest-filter';
import type { Json } from '@/types/database';
import type { FormatDefinition } from '@/lib/format-kit/client';
import type { LText } from '@/lib/studio-core/ltext';
import { FormatStudioError, mapFormatDbError } from '@/lib/format-studio/errors';
import type { FormatActor } from '@/lib/format-studio/access';
import type {
  FormatDefinitionMeta,
  FormatDefinitionSummary,
  FormatGalleryItem,
  FormatKind,
  FormatVersion,
  FormatVersionSummary,
  FormatVisibility,
} from '@/lib/format-studio/library-types';
import { isValidUuid } from '@/lib/utils/uuid';

/** Largest page of any list here. */
const MAX_PAGE = 100;

/** PostgREST answers an offset past the last row with this code when a count is requested. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

const META_COLUMNS =
  'id, slug, name, description, kind, owner_id, visibility, forked_from, draft_rev, current_version_id, created_at, updated_at';

const VERSION_SUMMARY_COLUMNS = 'id, version_no, schema_version, content_hash, changelog, created_by, created_at';
const VERSION_COLUMNS = `${VERSION_SUMMARY_COLUMNS}, definition_id, spec, status`;

interface MetaRow {
  id: string;
  slug: string;
  name: Json;
  description: Json | null;
  kind: string;
  owner_id: string | null;
  visibility: string;
  forked_from: string | null;
  draft_rev: number;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionSummaryRow {
  id: string;
  version_no: number;
  schema_version: number;
  content_hash: string;
  changelog: Json | null;
  created_by: string | null;
  created_at: string;
}

interface VersionRow extends VersionSummaryRow {
  definition_id: string;
  spec: Json;
  status: string;
}

function toMeta(row: MetaRow): FormatDefinitionMeta {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name as unknown as LText,
    description: row.description as unknown as LText | null,
    kind: row.kind as FormatKind,
    owner_id: row.owner_id,
    visibility: row.visibility as FormatVisibility,
    forked_from: row.forked_from,
    draft_rev: row.draft_rev,
    current_version_id: row.current_version_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toVersionSummary(row: VersionSummaryRow): FormatVersionSummary {
  return {
    id: row.id,
    version_no: row.version_no,
    schema_version: row.schema_version,
    content_hash: row.content_hash,
    changelog: row.changelog as unknown as LText | null,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function toVersion(row: VersionRow): FormatVersion {
  return {
    ...toVersionSummary(row),
    definition_id: row.definition_id,
    spec: row.spec as unknown as FormatDefinition,
    status: row.status === 'draft' ? 'draft' : 'published',
  };
}

/** A malformed id names no definition (and would fail the uuid filter as a 500). */
function isKnownIdShape(id: string): boolean {
  return typeof id === 'string' && isValidUuid(id);
}

/** Definition metadata (no draft body), or null. Live from the database: the ownership guard reads this. */
export async function getFormatDefinitionMeta(id: string): Promise<FormatDefinitionMeta | null> {
  if (!isKnownIdShape(id)) return null;
  const { data, error } = await supabase.from('format_definitions').select(META_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toMeta(data as unknown as MetaRow) : null;
}

/** The working draft and its revision: the only read of `current_draft`. */
export async function getFormatDefinitionDraft(id: string): Promise<{ document: unknown; draft_rev: number } | null> {
  if (!isKnownIdShape(id)) return null;
  const { data, error } = await supabase
    .from('format_definitions')
    .select('current_draft, draft_rev')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? { document: data.current_draft, draft_rev: data.draft_rev } : null;
}

export interface ListFormatsArgs {
  actor: FormatActor;
  scope: 'all' | 'mine' | 'shared';
  visibility?: FormatVisibility;
  kind?: FormatKind;
  limit: number;
  offset: number;
}

const SUMMARY_SELECT = `${META_COLUMNS}, owner:players!owner_id ( id, name ), current_version:format_definition_versions!current_version_id ( id, version_no, content_hash, created_at )`;

interface SummaryRow extends MetaRow {
  owner: { id: string; name: string } | null;
  current_version: { id: string; version_no: number; content_hash: string; created_at: string } | null;
}

function toSummary(row: SummaryRow): FormatDefinitionSummary {
  const { owner_id: _ownerId, current_version_id: _currentVersionId, ...meta } = toMeta(row);
  return {
    ...meta,
    owner: row.owner ? { id: row.owner.id, name: row.owner.name } : null,
    current_version: row.current_version
      ? {
          id: row.current_version.id,
          version_no: row.current_version.version_no,
          content_hash: row.current_version.content_hash,
          created_at: row.current_version.created_at,
        }
      : null,
  };
}

/**
 * A page of definitions the actor may see. A site admin sees every row; anyone else sees their own rows and the ones
 * shared with all admins (`league`, `gallery`). `mine` is the actor's own rows, `shared` the visible rows of others
 * (rows without an owner included). Newest change first, ties by id.
 */
export async function listFormatDefinitions(
  args: ListFormatsArgs,
): Promise<{ items: FormatDefinitionSummary[]; total: number }> {
  const limit = Math.min(Math.max(Math.trunc(args.limit), 1), MAX_PAGE);
  const offset = Math.max(Math.trunc(args.offset), 0);
  const me = postgrestQuoted(args.actor.playerId);

  const build = (head: boolean) => {
    let query = supabase.from('format_definitions').select(SUMMARY_SELECT, { count: 'exact', head });
    if (args.scope === 'mine') {
      query = query.eq('owner_id', args.actor.playerId);
    } else if (args.scope === 'shared') {
      query = query.in('visibility', ['league', 'gallery']).or(`owner_id.is.null,owner_id.neq.${me}`);
    } else if (!args.actor.isAdmin) {
      query = query.or(`owner_id.eq.${me},visibility.in.(league,gallery)`);
    }
    if (args.visibility) query = query.eq('visibility', args.visibility);
    if (args.kind) query = query.eq('kind', args.kind);
    return query;
  };

  const { data, error, count } = await build(false)
    .order('updated_at', { ascending: false })
    .order('id')
    .range(offset, offset + limit - 1);
  if (error) {
    if (error.code !== RANGE_NOT_SATISFIABLE) throw error;
    // The page is past the last row: report the real total so the caller can step back.
    const { count: total, error: countError } = await build(true);
    if (countError) throw countError;
    return { items: [], total: total ?? 0 };
  }

  return {
    items: ((data ?? []) as unknown as SummaryRow[]).map(toSummary),
    total: count ?? 0,
  };
}

/** The gallery shelf: published definitions with `visibility = 'gallery'`, newest first. No owner, no draft. */
export async function listGalleryDefinitions(limit = MAX_PAGE): Promise<FormatGalleryItem[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE);
  const { data, error } = await supabase
    .from('format_definitions')
    .select(
      'id, slug, name, description, kind, updated_at, current_version:format_definition_versions!current_version_id ( version_no, content_hash )',
    )
    .eq('visibility', 'gallery')
    .not('current_version_id', 'is', null)
    .order('updated_at', { ascending: false })
    .order('id')
    .limit(bounded);
  if (error) throw error;

  const items: FormatGalleryItem[] = [];
  for (const row of (data ?? []) as unknown as Array<{
    id: string;
    slug: string;
    name: Json;
    description: Json | null;
    kind: string;
    updated_at: string;
    current_version: { version_no: number; content_hash: string } | null;
  }>) {
    if (!row.current_version) continue;
    items.push({
      id: row.id,
      slug: row.slug,
      name: row.name as unknown as LText,
      description: row.description as unknown as LText | null,
      kind: row.kind as FormatKind,
      version_no: row.current_version.version_no,
      content_hash: row.current_version.content_hash,
      updated_at: row.updated_at,
    });
  }
  return items;
}

/** Create a private custom definition owned by `ownerId`. A taken slug throws `format_slug_taken`. */
export async function createFormatDefinition(input: {
  slug: string;
  name: LText;
  description: LText | null;
  ownerId: string;
  forkedFrom: string | null;
  document: object;
}): Promise<FormatDefinitionMeta> {
  const { data, error } = await supabase
    .from('format_definitions')
    .insert({
      slug: input.slug,
      name: input.name as unknown as Json,
      description: input.description as unknown as Json | null,
      kind: 'custom',
      owner_id: input.ownerId,
      visibility: 'private',
      forked_from: input.forkedFrom,
      current_draft: input.document as Json,
      draft_rev: 1,
    })
    .select(META_COLUMNS)
    .single();
  if (error) throw mapFormatDbError(error);
  return toMeta(data as unknown as MetaRow);
}

/**
 * Compare-and-set save of the draft: ONE statement that updates the row only while its revision still equals
 * `expectedRev`. Returns the new revision, or null when the revision moved or the definition is gone (the route
 * re-reads the metadata to tell a 404 from a 409). `name` and `description` follow the document's identity when the
 * caller passes them.
 */
export async function saveFormatDraft(input: {
  id: string;
  expectedRev: number;
  document: object;
  name?: LText;
  description?: LText | null;
}): Promise<{ draft_rev: number; updated_at: string } | null> {
  if (!isKnownIdShape(input.id)) return null;
  const update: {
    current_draft: Json;
    draft_rev: number;
    name?: Json;
    description?: Json | null;
  } = {
    current_draft: input.document as Json,
    draft_rev: input.expectedRev + 1,
  };
  if (input.name !== undefined) update.name = input.name as unknown as Json;
  if (input.description !== undefined) update.description = input.description as unknown as Json | null;

  const { data, error } = await supabase
    .from('format_definitions')
    .update(update)
    .eq('id', input.id)
    .eq('draft_rev', input.expectedRev)
    .select('draft_rev, updated_at')
    .maybeSingle();
  if (error) throw mapFormatDbError(error);
  return data ? { draft_rev: data.draft_rev, updated_at: data.updated_at } : null;
}

export async function setFormatVisibility(id: string, visibility: FormatVisibility): Promise<FormatDefinitionMeta> {
  if (!isKnownIdShape(id)) throw new FormatStudioError('format_not_found');
  const { data, error } = await supabase
    .from('format_definitions')
    .update({ visibility })
    .eq('id', id)
    .select(META_COLUMNS)
    .maybeSingle();
  if (error) throw mapFormatDbError(error);
  if (!data) throw new FormatStudioError('format_not_found');
  return toMeta(data as unknown as MetaRow);
}

export async function deleteFormatDefinition(id: string): Promise<void> {
  if (!isKnownIdShape(id)) return;
  const { error } = await supabase.from('format_definitions').delete().eq('id', id);
  if (error) throw error;
}

/** How many leagues have this definition attached (head count on `season_formats`). */
export async function countSeasonFormatsOfDefinition(id: string): Promise<number> {
  if (!isKnownIdShape(id)) return 0;
  const { count, error } = await supabase
    .from('season_formats')
    .select('season_id', { count: 'exact', head: true })
    .eq('definition_id', id);
  if (error) throw error;
  return count ?? 0;
}

/** How many versions the definition has (head count). */
export async function countFormatVersions(id: string): Promise<number> {
  if (!isKnownIdShape(id)) return 0;
  const { count, error } = await supabase
    .from('format_definition_versions')
    .select('id', { count: 'exact', head: true })
    .eq('definition_id', id);
  if (error) throw error;
  return count ?? 0;
}

/** Versions without their spec, newest first, at most 100. */
export async function listFormatVersions(definitionId: string, limit = MAX_PAGE): Promise<FormatVersionSummary[]> {
  if (!isKnownIdShape(definitionId)) return [];
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE);
  const { data, error } = await supabase
    .from('format_definition_versions')
    .select(VERSION_SUMMARY_COLUMNS)
    .eq('definition_id', definitionId)
    .order('version_no', { ascending: false })
    .limit(bounded);
  if (error) throw error;
  return ((data ?? []) as unknown as VersionSummaryRow[]).map(toVersionSummary);
}

export async function getFormatVersion(definitionId: string, versionNo: number): Promise<FormatVersion | null> {
  if (!isKnownIdShape(definitionId)) return null;
  const { data, error } = await supabase
    .from('format_definition_versions')
    .select(VERSION_COLUMNS)
    .eq('definition_id', definitionId)
    .eq('version_no', versionNo)
    .maybeSingle();
  if (error) throw error;
  return data ? toVersion(data as unknown as VersionRow) : null;
}

/** The latest published version: the one `current_version_id` points at, else the highest published number. */
export async function getLatestPublishedVersion(definitionId: string): Promise<FormatVersion | null> {
  if (!isKnownIdShape(definitionId)) return null;
  const pointer = await supabase
    .from('format_definitions')
    .select('current_version_id')
    .eq('id', definitionId)
    .maybeSingle();
  if (pointer.error) throw pointer.error;
  if (!pointer.data) return null;

  if (pointer.data.current_version_id) {
    const { data, error } = await supabase
      .from('format_definition_versions')
      .select(VERSION_COLUMNS)
      .eq('id', pointer.data.current_version_id)
      .maybeSingle();
    if (error) throw error;
    if (data) return toVersion(data as unknown as VersionRow);
  }

  const { data, error } = await supabase
    .from('format_definition_versions')
    .select(VERSION_COLUMNS)
    .eq('definition_id', definitionId)
    .eq('status', 'published')
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toVersion(data as unknown as VersionRow) : null;
}

/**
 * Atomic publish through `format_publish_version` (one transaction, row lock, revision compare). The function also
 * sets the definition's `name` and `description` from `specJson.identity` (`name`, `summary`), so a shared
 * definition's lists catch up with the published text; callers expire the gallery shelf afterwards.
 */
export async function publishFormatVersion(input: {
  definitionId: string;
  expectedRev: number;
  specJson: FormatDefinition;
  contentHash: string;
  changelog: LText | null;
  actorId: string;
}): Promise<{ versionId: string; versionNo: number }> {
  const { data, error } = await supabase.rpc('format_publish_version', {
    p_definition_id: input.definitionId,
    p_expected_rev: input.expectedRev,
    p_schema_version: input.specJson.schema_version,
    p_spec: input.specJson as unknown as Json,
    p_content_hash: input.contentHash,
    p_changelog: input.changelog as unknown as Json,
    p_actor: input.actorId,
  });
  if (error) throw mapFormatDbError(error);
  const row = data?.[0];
  if (!row) throw new Error('format_publish_version returned no row');
  return { versionId: row.out_version_id, versionNo: row.out_version_no };
}
