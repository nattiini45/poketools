/**
 * Queries behind the ruleset library (`ruleset_definitions`, `ruleset_definition_versions`). Server only. The twin of
 * `format-definitions.ts`.
 *
 * Every read names its columns: the draft body (`current_draft`) is selected only by `getRulesetDefinitionDraft`, the
 * document and the resolved rules (`spec`, `resolved`, up to 256 KB each) only by the single-version reads, never by a
 * list or a guard read. Lists are bounded (`.range()` plus an exact count, at most 100 rows), the version list is capped at
 * 100, and no user text ever reaches a filter string: the one `.or()` quotes the player id with `postgrestQuoted`. Database
 * signals (slug taken, document too large to store, publish races, a pinned version) leave this module as
 * `RulesetStudioError` through `mapRulesetDbError`.
 *
 * The routes check access first (`src/lib/ruleset-studio/guards.ts`); these functions run as the service role and enforce
 * nothing themselves.
 */
import 'server-only';

import { supabase } from '../client';
import { postgrestQuoted } from '../postgrest-filter';
import { readBoundedPages } from '../read-bounded-pages';
import type { Json } from '@/types/database';
import type { LText } from '@/lib/format-kit/types';
import type { ResolvedRules, RulesetDocument } from '@/lib/ruleset-kit/types';
import type { RulesetActor } from '@/lib/ruleset-studio/access';
import { RulesetStudioError, mapRulesetDbError } from '@/lib/ruleset-studio/errors';
import type {
  RulesetDefinitionMeta,
  RulesetDefinitionSummary,
  RulesetKind,
  RulesetPinCounts,
  RulesetVersion,
  RulesetVersionSummary,
  RulesetVisibility,
} from '@/lib/ruleset-studio/library-types';
import { isValidUuid } from '@/lib/utils/uuid';

/** Largest page of any list here. */
const MAX_PAGE = 100;

/** PostgREST answers an offset past the last row with this code when a count is requested. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

const META_COLUMNS =
  'id, slug, name, description, kind, owner_id, visibility, season_id, forked_from, draft_rev, current_version_id, created_at, updated_at';

/** `base_preset` is read as a JSON path (`spec.base.preset`), so a list never selects the document itself. */
const BASE_PRESET_PATH = 'base_preset:spec->base->>preset';
const VERSION_SUMMARY_COLUMNS = `id, version_no, schema_version, name_text, content_hash, resolved_hash, catalog_version, ${BASE_PRESET_PATH}, gen, format_key, is_doubles, changelog, created_by, created_at`;
const VERSION_COLUMNS = `${VERSION_SUMMARY_COLUMNS}, definition_id, spec, resolved`;

interface MetaRow {
  id: string;
  slug: string;
  name: Json;
  description: Json | null;
  kind: string;
  owner_id: string | null;
  visibility: string;
  season_id: string | null;
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
  name_text: string;
  content_hash: string;
  resolved_hash: string;
  catalog_version: string;
  base_preset: string | null;
  gen: number;
  format_key: string;
  is_doubles: boolean;
  changelog: Json | null;
  created_by: string | null;
  created_at: string;
}

interface VersionRow extends VersionSummaryRow {
  definition_id: string;
  spec: Json;
  resolved: Json;
}

function toMeta(row: MetaRow): RulesetDefinitionMeta {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name as unknown as LText,
    description: row.description as unknown as LText | null,
    kind: row.kind as RulesetKind,
    owner_id: row.owner_id,
    visibility: row.visibility as RulesetVisibility,
    season_id: row.season_id,
    forked_from: row.forked_from,
    draft_rev: row.draft_rev,
    current_version_id: row.current_version_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toVersionSummary(row: VersionSummaryRow): RulesetVersionSummary {
  return {
    id: row.id,
    version_no: row.version_no,
    schema_version: row.schema_version,
    name_text: row.name_text,
    content_hash: row.content_hash,
    resolved_hash: row.resolved_hash,
    catalog_version: row.catalog_version,
    base_preset: row.base_preset,
    gen: row.gen,
    format_key: row.format_key,
    is_doubles: row.is_doubles,
    changelog: row.changelog as unknown as LText | null,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function toVersion(row: VersionRow): RulesetVersion {
  return {
    ...toVersionSummary(row),
    definition_id: row.definition_id,
    spec: row.spec as unknown as RulesetDocument,
    resolved: row.resolved as unknown as ResolvedRules,
  };
}

/** A malformed id names no definition (and would fail the uuid filter as a 500). */
function isKnownIdShape(id: string): boolean {
  return typeof id === 'string' && isValidUuid(id);
}

/** Definition metadata (no draft body), or null. Live from the database: the ownership guard reads this. */
export async function getRulesetDefinitionMeta(id: string): Promise<RulesetDefinitionMeta | null> {
  if (!isKnownIdShape(id)) return null;
  const { data, error } = await supabase.from('ruleset_definitions').select(META_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toMeta(data as unknown as MetaRow) : null;
}

/** The working draft and its revision: the only read of `current_draft`. */
export async function getRulesetDefinitionDraft(id: string): Promise<{ document: unknown; draft_rev: number } | null> {
  if (!isKnownIdShape(id)) return null;
  const { data, error } = await supabase
    .from('ruleset_definitions')
    .select('current_draft, draft_rev')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? { document: data.current_draft, draft_rev: data.draft_rev } : null;
}

/** The definition a version belongs to (metadata only), with the version number; null for an unknown version id. */
export async function getDefinitionOfVersion(
  versionId: string,
): Promise<{ definition: RulesetDefinitionMeta; version_no: number } | null> {
  if (!isKnownIdShape(versionId)) return null;
  const { data, error } = await supabase
    .from('ruleset_definition_versions')
    .select('version_no, definition:ruleset_definitions!definition_id ( ' + META_COLUMNS + ' )')
    .eq('id', versionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as { version_no: number; definition: MetaRow | null };
  return row.definition ? { definition: toMeta(row.definition), version_no: row.version_no } : null;
}

export interface ListRulesetsArgs {
  actor: RulesetActor;
  scope: 'all' | 'mine' | 'shared';
  visibility?: RulesetVisibility;
  kind?: RulesetKind;
  limit: number;
  offset: number;
}

const SUMMARY_SELECT = `${META_COLUMNS}, owner:players!owner_id ( id, name ), current_version:ruleset_definition_versions!current_version_id ( id, version_no, content_hash, created_at, catalog_version, ${BASE_PRESET_PATH} )`;

interface SummaryRow extends MetaRow {
  owner: { id: string; name: string } | null;
  current_version: {
    id: string;
    version_no: number;
    content_hash: string;
    created_at: string;
    catalog_version: string;
    base_preset: string | null;
  } | null;
}

function toSummary(row: SummaryRow): RulesetDefinitionSummary {
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
          catalog_version: row.current_version.catalog_version,
          base_preset: row.current_version.base_preset,
        }
      : null,
  };
}

/**
 * A page of definitions the actor may see. A site admin sees every row; anyone else sees their own rows and the ones
 * shared with all admins (`league`, `gallery`). `mine` is the actor's own rows, `shared` the visible rows of others (rows
 * without an owner included). Newest change first, ties by id.
 */
export async function listRulesetDefinitions(
  args: ListRulesetsArgs,
): Promise<{ items: RulesetDefinitionSummary[]; total: number }> {
  const limit = Math.min(Math.max(Math.trunc(args.limit), 1), MAX_PAGE);
  const offset = Math.max(Math.trunc(args.offset), 0);
  const me = postgrestQuoted(args.actor.playerId);

  const build = (head: boolean) => {
    let query = supabase.from('ruleset_definitions').select(SUMMARY_SELECT, { count: 'exact', head });
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

  return { items: ((data ?? []) as unknown as SummaryRow[]).map(toSummary), total: count ?? 0 };
}

/** Create a definition owned by `ownerId`: private and custom unless the caller (a seed or an attach) says otherwise. */
export async function createRulesetDefinition(input: {
  slug: string;
  name: LText;
  description: LText | null;
  ownerId: string | null;
  forkedFrom: string | null;
  document: object;
  kind?: RulesetKind;
  visibility?: RulesetVisibility;
  seasonId?: string | null;
}): Promise<RulesetDefinitionMeta> {
  const { data, error } = await supabase
    .from('ruleset_definitions')
    .insert({
      slug: input.slug,
      name: input.name as unknown as Json,
      description: input.description as unknown as Json | null,
      kind: input.kind ?? 'custom',
      owner_id: input.ownerId,
      visibility: input.visibility ?? 'private',
      season_id: input.seasonId ?? null,
      forked_from: input.forkedFrom,
      current_draft: input.document as Json,
      draft_rev: 1,
    })
    .select(META_COLUMNS)
    .single();
  if (error) throw mapRulesetDbError(error);
  return toMeta(data as unknown as MetaRow);
}

/** How many definitions the player owns (for the per-owner cap). */
export async function countOwnedRulesetDefinitions(ownerId: string): Promise<number> {
  if (!isKnownIdShape(ownerId)) return 0;
  const { count, error } = await supabase
    .from('ruleset_definitions')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Compare-and-set save of the draft: ONE statement that updates the row only while its revision still equals
 * `expectedRev`. Returns the new revision, or null when the revision moved or the definition is gone (the caller re-reads
 * the metadata to tell a 404 from a 409). `name` and `description` follow the document's identity when passed.
 */
export async function saveRulesetDraft(input: {
  id: string;
  expectedRev: number;
  document: object;
  name?: LText;
  description?: LText | null;
}): Promise<{ draft_rev: number; updated_at: string } | null> {
  if (!isKnownIdShape(input.id)) return null;
  const update: { current_draft: Json; draft_rev: number; name?: Json; description?: Json | null } = {
    current_draft: input.document as Json,
    draft_rev: input.expectedRev + 1,
  };
  if (input.name !== undefined) update.name = input.name as unknown as Json;
  if (input.description !== undefined) update.description = input.description as unknown as Json | null;

  const { data, error } = await supabase
    .from('ruleset_definitions')
    .update(update)
    .eq('id', input.id)
    .eq('draft_rev', input.expectedRev)
    .select('draft_rev, updated_at')
    .maybeSingle();
  if (error) throw mapRulesetDbError(error);
  return data ? { draft_rev: data.draft_rev, updated_at: data.updated_at } : null;
}

export async function setRulesetVisibility(id: string, visibility: RulesetVisibility): Promise<RulesetDefinitionMeta> {
  if (!isKnownIdShape(id)) throw new RulesetStudioError('ruleset_not_found');
  const { data, error } = await supabase
    .from('ruleset_definitions')
    .update({ visibility })
    .eq('id', id)
    .select(META_COLUMNS)
    .maybeSingle();
  if (error) throw mapRulesetDbError(error);
  if (!data) throw new RulesetStudioError('ruleset_not_found');
  return toMeta(data as unknown as MetaRow);
}

/**
 * Deletes a definition and (by cascade) its versions. A version that a league or phase pins keeps the delete from
 * happening (`ruleset_in_use`); the caller checks the pins first for the count.
 */
export async function deleteRulesetDefinition(id: string, inUseCount = 1): Promise<void> {
  if (!isKnownIdShape(id)) return;
  const { error } = await supabase.from('ruleset_definitions').delete().eq('id', id);
  if (error) throw mapRulesetDbError(error, inUseCount);
}

/** The ids of every version of a definition (at most 100 by the publish function's quota). */
export async function listVersionIds(definitionId: string): Promise<string[]> {
  if (!isKnownIdShape(definitionId)) return [];
  const { data, error } = await supabase
    .from('ruleset_definition_versions')
    .select('id')
    .eq('definition_id', definitionId)
    .limit(MAX_PAGE);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

export interface PinRow {
  id: string;
  name: string;
  status: string;
  /** For a phase: the league it belongs to. */
  season_id: string | null;
  ruleset_id: string;
}

/** The leagues and phases that pin any of `versionIds`. Complete under `max_rows`. */
export async function listPinnedTargets(versionIds: readonly string[]): Promise<{ seasons: PinRow[]; tournaments: PinRow[] }> {
  if (versionIds.length === 0) return { seasons: [], tournaments: [] };
  const ids = [...versionIds];
  const [seasons, tournaments] = await Promise.all([
    readBoundedPages<{ id: string; name: string; status: string; ruleset_id: string | null }>(
      (from, to) => supabase.from('seasons').select('id, name, status, ruleset_id').in('ruleset_id', ids).order('id').range(from, to),
      { label: 'listPinnedTargets seasons' },
    ),
    readBoundedPages<{ id: string; name: string; status: string; season_id: string | null; ruleset_id: string }>(
      (from, to) =>
        supabase.from('tournaments').select('id, name, status, season_id, ruleset_id').in('ruleset_id', ids).order('id').range(from, to),
      { label: 'listPinnedTargets tournaments' },
    ),
  ]);
  return {
    seasons: seasons.rows.flatMap((row) =>
      row.ruleset_id === null ? [] : [{ id: row.id, name: row.name, status: row.status, season_id: null, ruleset_id: row.ruleset_id }],
    ),
    tournaments: tournaments.rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      season_id: row.season_id,
      ruleset_id: row.ruleset_id,
    })),
  };
}

/** Versions without their spec, newest first, at most 100. */
export async function listRulesetVersions(definitionId: string, limit = MAX_PAGE): Promise<RulesetVersionSummary[]> {
  if (!isKnownIdShape(definitionId)) return [];
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE);
  const { data, error } = await supabase
    .from('ruleset_definition_versions')
    .select(VERSION_SUMMARY_COLUMNS)
    .eq('definition_id', definitionId)
    .order('version_no', { ascending: false })
    .limit(bounded);
  if (error) throw error;
  return ((data ?? []) as unknown as VersionSummaryRow[]).map(toVersionSummary);
}

export async function getRulesetVersion(definitionId: string, versionNo: number): Promise<RulesetVersion | null> {
  if (!isKnownIdShape(definitionId)) return null;
  const { data, error } = await supabase
    .from('ruleset_definition_versions')
    .select(VERSION_COLUMNS)
    .eq('definition_id', definitionId)
    .eq('version_no', versionNo)
    .maybeSingle();
  if (error) throw error;
  return data ? toVersion(data as unknown as VersionRow) : null;
}

/** The latest published version: the one `current_version_id` points at, else the highest version number. */
export async function getLatestPublishedRulesetVersion(definitionId: string): Promise<RulesetVersion | null> {
  if (!isKnownIdShape(definitionId)) return null;
  const pointer = await supabase.from('ruleset_definitions').select('current_version_id').eq('id', definitionId).maybeSingle();
  if (pointer.error) throw pointer.error;
  if (!pointer.data) return null;

  if (pointer.data.current_version_id) {
    const { data, error } = await supabase
      .from('ruleset_definition_versions')
      .select(VERSION_COLUMNS)
      .eq('id', pointer.data.current_version_id)
      .maybeSingle();
    if (error) throw error;
    if (data) return toVersion(data as unknown as VersionRow);
  }

  const { data, error } = await supabase
    .from('ruleset_definition_versions')
    .select(VERSION_COLUMNS)
    .eq('definition_id', definitionId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toVersion(data as unknown as VersionRow) : null;
}

/**
 * Atomic publish through `ruleset_publish_version` (one transaction, row lock, revision compare). The function also sets the
 * definition's `name` and `description` from `spec.identity`, so a shared definition's lists catch up with the published
 * text; callers expire the library shelf afterwards.
 */
export async function publishRulesetVersion(input: {
  definitionId: string;
  expectedRev: number;
  spec: RulesetDocument;
  contentHash: string;
  resolved: ResolvedRules;
  resolvedHash: string;
  catalogVersion: string;
  changelog: LText | null;
  actorId: string | null;
}): Promise<{ versionId: string; versionNo: number }> {
  const { data, error } = await supabase.rpc('ruleset_publish_version', {
    p_definition_id: input.definitionId,
    p_expected_rev: input.expectedRev,
    p_schema_version: input.spec.schema_version,
    p_spec: input.spec as unknown as Json,
    p_content_hash: input.contentHash,
    p_resolved: input.resolved as unknown as Json,
    p_resolved_hash: input.resolvedHash,
    p_catalog_version: input.catalogVersion,
    p_gen: input.resolved.gen,
    p_format_key: input.resolved.format_key,
    p_is_doubles: input.resolved.doubles,
    p_changelog: input.changelog as unknown as Json,
    p_actor: input.actorId as string,
  });
  if (error) throw mapRulesetDbError(error);
  const row = data?.[0];
  if (!row) throw new Error('ruleset_publish_version returned no row');
  return { versionId: row.out_version_id, versionNo: row.out_version_no };
}

/**
 * The frozen resolved rules of some versions of one definition (`version_no` to rules), for a comparison of versions. The
 * rules can be large (up to 256 KB), so the caller names the few versions it needs; at most 25 are read.
 */
export async function listVersionRules(definitionId: string, versionNos: readonly number[]): Promise<Map<number, ResolvedRules>> {
  const rules = new Map<number, ResolvedRules>();
  if (!isKnownIdShape(definitionId) || versionNos.length === 0) return rules;
  const { data, error } = await supabase
    .from('ruleset_definition_versions')
    .select('version_no, resolved')
    .eq('definition_id', definitionId)
    .in('version_no', [...versionNos].slice(0, 25));
  if (error) throw error;
  for (const row of data ?? []) rules.set(row.version_no, row.resolved as unknown as ResolvedRules);
  return rules;
}

/** Definitions per `count` request: keeps the filter short (a uuid is 36 characters in the URL). */
const COUNT_CHUNK = 50;

/**
 * How many leagues and phases pin a version of each definition, over all its versions, in one embedded count per version
 * (`seasons ( count )`, `tournaments ( count )`; no pinned row is fetched, so a ruleset used by hundreds of phases costs the
 * same as an unused one). A definition nobody pins is present with zeros. The caller shows these counts to everyone who may
 * see the definition; the names stay with `listPinnedTargets`.
 */
export async function countPinsByDefinition(definitionIds: readonly string[]): Promise<Map<string, RulesetPinCounts>> {
  const counts = new Map<string, RulesetPinCounts>();
  const ids = [...new Set(definitionIds.filter(isKnownIdShape))];
  for (const id of ids) counts.set(id, { seasons: 0, tournaments: 0 });

  for (let at = 0; at < ids.length; at += COUNT_CHUNK) {
    const chunk = ids.slice(at, at + COUNT_CHUNK);
    const { rows } = await readBoundedPages<{
      definition_id: string;
      seasons: Array<{ count: number }> | null;
      tournaments: Array<{ count: number }> | null;
    }>(
      (from, to) =>
        supabase
          .from('ruleset_definition_versions')
          .select('definition_id, seasons ( count ), tournaments ( count )')
          .in('definition_id', chunk)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: Array<{
            definition_id: string;
            seasons: Array<{ count: number }> | null;
            tournaments: Array<{ count: number }> | null;
          }> | null;
          error: unknown;
        }>,
      { label: 'countPinsByDefinition' },
    );
    for (const row of rows) {
      const entry = counts.get(row.definition_id);
      if (entry === undefined) continue;
      entry.seasons += row.seasons?.[0]?.count ?? 0;
      entry.tournaments += row.tournaments?.[0]?.count ?? 0;
    }
  }
  return counts;
}

// ─── Pins ─────────────────────────────────────────────────────────────────────

export interface PinTargetState {
  kind: 'season' | 'tournament';
  id: string;
  name: string;
  status: string;
  /** For a phase: its league. */
  season_id: string | null;
  /** The version the target pins now (a league may have none). */
  ruleset_id: string | null;
}

/** The current state of leagues and phases (name, status, the version they pin). Unknown ids are absent from the answer. */
export async function getPinTargetStates(
  seasonIds: readonly string[],
  tournamentIds: readonly string[],
): Promise<PinTargetState[]> {
  const [seasons, tournaments] = await Promise.all([
    seasonIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('seasons').select('id, name, status, ruleset_id').in('id', [...seasonIds]),
    tournamentIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('tournaments').select('id, name, status, season_id, ruleset_id').in('id', [...tournamentIds]),
  ]);
  if (seasons.error) throw seasons.error;
  if (tournaments.error) throw tournaments.error;
  return [
    ...(seasons.data ?? []).map((row) => ({
      kind: 'season' as const,
      id: row.id,
      name: row.name,
      status: row.status,
      season_id: null,
      ruleset_id: row.ruleset_id,
    })),
    ...(tournaments.data ?? []).map((row) => ({
      kind: 'tournament' as const,
      id: row.id,
      name: row.name,
      status: row.status,
      season_id: row.season_id,
      ruleset_id: row.ruleset_id,
    })),
  ];
}

/**
 * Moves one league or phase to another version, as a compare-and-set on the version it pinned when the caller read it.
 * Returns false when the pin moved in the meantime (the caller reports a conflict). The pin foreign key refuses an id that is
 * not a version.
 */
export async function repinTarget(kind: 'season' | 'tournament', id: string, from: string | null, to: string): Promise<boolean> {
  const table = kind === 'season' ? 'seasons' : 'tournaments';
  const base = supabase.from(table).update({ ruleset_id: to }).eq('id', id);
  const { data, error } = await (from === null ? base.is('ruleset_id', null) : base.eq('ruleset_id', from)).select('id');
  if (error) throw error;
  return (data ?? []).length === 1;
}

/** Whether any league or phase pins this version (head counts on both tables). */
export async function isVersionPinned(versionId: string): Promise<boolean> {
  if (!isKnownIdShape(versionId)) return false;
  const [seasons, tournaments] = await Promise.all([
    supabase.from('seasons').select('id', { count: 'exact', head: true }).eq('ruleset_id', versionId),
    supabase.from('tournaments').select('id', { count: 'exact', head: true }).eq('ruleset_id', versionId),
  ]);
  if (seasons.error) throw seasons.error;
  if (tournaments.error) throw tournaments.error;
  return (seasons.count ?? 0) + (tournaments.count ?? 0) > 0;
}
