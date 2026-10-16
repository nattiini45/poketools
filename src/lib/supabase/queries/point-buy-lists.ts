import { supabase } from '../client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { applyLeagueOverrides } from '@/lib/draft/league-overrides';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import type { Tables, TablesInsert } from '@/types/database';
import type {
  PointBuyListVersion,
  PointBuyListVersionFormData,
  PointBuyListEntry,
  PointBuyListEntryFormData,
} from '@/types/point-buy';

type ListVersionRow = Tables<'point_buy_list_versions'>;
type ListEntryRow = Tables<'point_buy_list_entries'>;

function toVersion(row: ListVersionRow): PointBuyListVersion {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    source: row.source,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

/**
 * The stored `line_id` (migration M1), or the same id computed from the stage
 * names for a row read before M1 is applied (the M1 trigger guarantees they agree).
 */
function lineIdOfRow(row: ListEntryRow): string {
  const stored = 'line_id' in row && typeof row.line_id === 'string' ? row.line_id : null;
  return lineIdOfEntry({ ...row, line_id: stored });
}

/**
 * Every read path maps rows through here: the row fields, its line id, and the
 * league overrides applied (`overrides` lists what changed; `[]` when nothing did).
 */
function toEntry(row: ListEntryRow): PointBuyListEntry {
  return applyLeagueOverrides(toStoredEntry(row));
}

function toStoredEntry(row: ListEntryRow): PointBuyListEntry & { line_id: string } {
  return {
    id: row.id,
    list_version_id: row.list_version_id,
    line_number: row.line_number,
    line_id: lineIdOfRow(row),
    base_pokemon: row.base_pokemon,
    stage2_pokemon: row.stage2_pokemon,
    stage3_pokemon: row.stage3_pokemon,
    price: row.price,
    kills_to_stage2: row.kills_to_stage2,
    additional_kills_to_stage3: row.additional_kills_to_stage3,
    price_group: row.price_group as PointBuyListEntry['price_group'],
    early_rating: row.early_rating,
    mid_rating: row.mid_rating,
    late_rating: row.late_rating,
    rationale: row.rationale,
    historical_data: row.historical_data,
    special_rules: (row.special_rules as PointBuyListEntry['special_rules']) ?? null,
    special_rules_text: row.special_rules_text,
    sources: row.sources,
    legacy_tier: row.legacy_tier,
    species_ids: (row.species_ids as PointBuyListEntry['species_ids']) ?? null,
  };
}

// ─── List Versions ───────────────────────────────────────────────

/** Get all point-buy list versions, newest first. */
export async function getPointBuyListVersions(): Promise<PointBuyListVersion[]> {
  const { data, error } = await supabase
    .from('point_buy_list_versions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map(toVersion);
}

/** Get a single list version by ID. */
export async function getPointBuyListById(id: string): Promise<PointBuyListVersion | null> {
  const { data, error } = await supabase
    .from('point_buy_list_versions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toVersion(data) : null;
}

/** Get the currently active list version (if any). */
export async function getActiveListVersion(): Promise<PointBuyListVersion | null> {
  const { data, error } = await supabase
    .from('point_buy_list_versions')
    .select('*')
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? toVersion(data) : null;
}

/** Create a new list version. */
export async function createListVersion(
  input: PointBuyListVersionFormData
): Promise<PointBuyListVersion> {
  const insert: TablesInsert<'point_buy_list_versions'> = {
    name: input.name,
    version: input.version ?? 1,
    source: input.source ?? null,
  };

  const { data, error } = await supabase
    .from('point_buy_list_versions')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toVersion(data);
}

/** Deactivate a list version (and optionally activate another). */
export async function deactivateListVersion(id: string): Promise<void> {
  const { error } = await supabase
    .from('point_buy_list_versions')
    .update({ is_active: false })
    .eq('id', id);

  if (error) throw error;
}

// ─── List Entries ────────────────────────────────────────────────

/** Get all entries for a list version, ordered by line number. */
export async function getListEntries(versionId: string): Promise<PointBuyListEntry[]> {
  const { data, error } = await supabase
    .from('point_buy_list_entries')
    .select('*')
    .eq('list_version_id', versionId)
    .order('line_number');

  if (error) throw error;
  return data.map(toEntry);
}

/** Get a single entry by its row id (any version). */
export async function getListEntryById(entryId: string): Promise<PointBuyListEntry | null> {
  const { data, error } = await supabase
    .from('point_buy_list_entries')
    .select('*')
    .eq('id', entryId)
    .maybeSingle();

  if (error) throw error;
  return data ? toEntry(data) : null;
}

/** Get the entry of one line (stored `line_id`, migration M1) within a version. */
export async function getListEntryByLineId(
  versionId: string,
  lineId: string
): Promise<PointBuyListEntry | null> {
  const { data, error } = await supabase
    .from('point_buy_list_entries')
    .select('*')
    .eq('list_version_id', versionId)
    .eq('line_id', lineId)
    .maybeSingle();

  if (error) throw error;
  return data ? toEntry(data) : null;
}

/** Get a single entry by base pokemon name within a version. */
export async function getListEntryByBase(
  versionId: string,
  basePokemon: string
): Promise<PointBuyListEntry | null> {
  const { data, error } = await supabase
    .from('point_buy_list_entries')
    .select('*')
    .eq('list_version_id', versionId)
    .eq('base_pokemon', basePokemon)
    .maybeSingle();

  if (error) throw error;
  return data ? toEntry(data) : null;
}

/**
 * Get a point-buy entry by base + stage-3 branch.
 * When stage3 is omitted, returns the sole entry for that base (if unique).
 */
export async function getListEntryByBaseAndStage3(
  versionId: string,
  basePokemon: string,
  stage3Pokemon?: string | null
): Promise<PointBuyListEntry | null> {
  if (stage3Pokemon === undefined || stage3Pokemon === null) {
    const { data, error } = await supabase
      .from('point_buy_list_entries')
      .select('*')
      .eq('list_version_id', versionId)
      .eq('base_pokemon', basePokemon);

    if (error) throw error;
    if (!data || data.length === 0) return null;
    if (data.length === 1) return toEntry(data[0]);
    return null;
  }

  const { data, error } = await supabase
    .from('point_buy_list_entries')
    .select('*')
    .eq('list_version_id', versionId)
    .eq('base_pokemon', basePokemon)
    .eq('stage3_pokemon', stage3Pokemon)
    .maybeSingle();

  if (error) throw error;
  return data ? toEntry(data) : null;
}

/**
 * Check whether a list version is bound to any season that is no longer
 * 'upcoming'. Bound versions are immutable snapshots — a later import must
 * never retroactively change prices, texts, or kill requirements of running
 * or completed seasons.
 */
export async function isVersionBoundToActiveSeason(versionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('seasons')
    .select('id')
    .eq('point_buy_list_id', versionId)
    .neq('status', 'upcoming')
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Whether any season (whatever its status) is bound to this list version. The
 * public search index serves only bound versions to non-admins.
 */
export async function isVersionBoundToAnySeason(versionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('seasons')
    .select('id')
    .eq('point_buy_list_id', versionId)
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Bulk create entries for a list version (used by import). */
export async function bulkCreateListEntries(
  versionId: string,
  entries: PointBuyListEntryFormData[]
): Promise<number> {
  if (entries.length === 0) return 0;

  // Snapshot protection: refuse writes to a version bound to a running or
  // completed season (a DB trigger enforces the same invariant as backstop).
  if (await isVersionBoundToActiveSeason(versionId)) {
    throw new UserFacingError(
      'This point-buy list version is bound to an active or completed season and cannot be modified. Create a new version instead.',
      { code: 'list_version_immutable', status: 409 }
    );
  }

  // `line_id` is sent so the M1 trigger can refuse a TS/SQL fold drift; without it the trigger fills it.
  const rows: (TablesInsert<'point_buy_list_entries'> & { line_id: string })[] = entries.map((e) => ({
    list_version_id: versionId,
    line_number: e.line_number,
    line_id: e.line_id ?? lineIdOfEntry({
      base_pokemon: e.base_pokemon,
      stage2_pokemon: e.stage2_pokemon,
      stage3_pokemon: e.stage3_pokemon ?? null,
    }),
    base_pokemon: e.base_pokemon,
    stage2_pokemon: e.stage2_pokemon,
    stage3_pokemon: e.stage3_pokemon ?? null,
    price: e.price,
    kills_to_stage2: e.kills_to_stage2,
    additional_kills_to_stage3: e.additional_kills_to_stage3 ?? null,
    price_group: e.price_group,
    early_rating: e.early_rating ?? null,
    mid_rating: e.mid_rating ?? null,
    late_rating: e.late_rating ?? null,
    rationale: e.rationale ?? null,
    historical_data: e.historical_data ?? null,
    special_rules: e.special_rules ? JSON.parse(JSON.stringify(e.special_rules)) : null,
    special_rules_text: e.special_rules_text ?? null,
    sources: e.sources ?? null,
    legacy_tier: e.legacy_tier ?? null,
    species_ids: e.species_ids ? JSON.parse(JSON.stringify(e.species_ids)) : null,
  }));

  const { error } = await supabase
    .from('point_buy_list_entries')
    .upsert(rows, { onConflict: 'list_version_id,line_number' });

  if (error) throw error;
  return entries.length;
}

// ─── Season Binding ──────────────────────────────────────────────

/**
 * Bind a season to a point-buy list version (immutable snapshot).
 * First bind is allowed regardless of season status when point_buy_list_id
 * is still null (no snapshot to protect). Rebinding a different version is
 * only allowed for 'upcoming' seasons.
 */
export async function bindSeasonToList(
  seasonId: string,
  versionId: string
): Promise<void> {
  const { data: season, error: sErr } = await supabase
    .from('seasons')
    .select('status, point_buy_list_id')
    .eq('id', seasonId)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!season) {
    throw new UserFacingError('Season not found', { code: 'season_not_found', status: 404 });
  }
  if (
    season.point_buy_list_id != null &&
    season.status !== 'upcoming' &&
    season.point_buy_list_id !== versionId
  ) {
    throw new UserFacingError(
      'Only upcoming seasons can be bound to a different point-buy list version',
      { code: 'season_list_binding_locked', status: 409 }
    );
  }

  const { error } = await supabase
    .from('seasons')
    .update({ point_buy_list_id: versionId })
    .eq('id', seasonId);

  if (error) throw error;
}
