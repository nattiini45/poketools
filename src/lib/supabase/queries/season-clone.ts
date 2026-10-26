import { supabase } from '../client';
import { DEFAULT_CONTENT_LOCALE, isLocale } from '@/i18n/config';
import type { CloneSourceOption } from '@/lib/league-admin/clone-source';
import type { RouteThemeId, SeasonFormatType, SeasonStatus } from '@/types/season';

/** Leagues offered as clone sources: the newest, bounded (PostgREST caps a response at 1000 rows). */
export const CLONE_SOURCE_LIMIT = 100;

/** Roster rows per insert and per read page. */
export const CLONE_ROSTER_CHUNK = 500;
const ROSTER_READ_CHUNK = 1000;

function embeddedCount(embed: { count: number }[] | null | undefined): number {
  return embed?.[0]?.count ?? 0;
}

/**
 * The leagues a viewer may start a new league from: lean season fields plus
 * the phase and roster counts as embedded COUNTs (no player rows, no child id
 * arrays). Archived and test leagues are included: last season's archived
 * league is the typical source; custom-format leagues are left out (`isCloneSourceFormat`). `seasonIds` scopes a resource admin to their
 * own leagues (`null` = no scope, for site admins); an empty list reads nothing.
 */
export async function listCloneSourceOptions(seasonIds: string[] | null): Promise<CloneSourceOption[]> {
  if (seasonIds && seasonIds.length === 0) return [];

  let query = supabase
    .from('seasons')
    .select(
      'id, name, format_type, status, archived, is_test_season, ruleset_id, route_theme, language, description, tournaments ( count ), season_participants ( count )',
    );
  if (seasonIds) query = query.in('id', seasonIds);
  // A custom league is no source (its phases come from an attached format): leave it out here so it
  // does not use up one of the bounded rows either.
  query = query.neq('format_type', 'custom');

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(CLONE_SOURCE_LIMIT);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    format_type: row.format_type as SeasonFormatType,
    status: row.status as SeasonStatus,
    archived: row.archived,
    is_test_season: row.is_test_season,
    ruleset_id: row.ruleset_id,
    route_theme: row.route_theme as RouteThemeId,
    language: isLocale(row.language) ? row.language : DEFAULT_CONTENT_LOCALE,
    description: row.description,
    phase_count: embeddedCount(row.tournaments as { count: number }[] | null),
    participant_count: embeddedCount(row.season_participants as { count: number }[] | null),
  }));
}

/**
 * The player ids on a league's roster, in `.range()` pages with a stable order
 * (no player rows: a clone copies the membership only).
 */
export async function listSeasonParticipantIds(seasonId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += ROSTER_READ_CHUNK) {
    const { data, error } = await supabase
      .from('season_participants')
      .select('player_id')
      .eq('season_id', seasonId)
      .order('player_id')
      .range(from, from + ROSTER_READ_CHUNK - 1);
    if (error) throw error;
    const chunk = data ?? [];
    ids.push(...chunk.map((row) => row.player_id));
    if (chunk.length < ROSTER_READ_CHUNK) break;
  }
  return ids;
}

/**
 * Adds players to a league's roster with bulk inserts of at most
 * `CLONE_ROSTER_CHUNK` rows. Only the membership is written: `gym_type`,
 * `core_types` and league groups are never copied.
 */
export async function addSeasonParticipants(seasonId: string, playerIds: string[]): Promise<void> {
  for (let i = 0; i < playerIds.length; i += CLONE_ROSTER_CHUNK) {
    const rows = playerIds.slice(i, i + CLONE_ROSTER_CHUNK).map((player_id) => ({
      season_id: seasonId,
      player_id,
    }));
    const { error } = await supabase.from('season_participants').insert(rows);
    if (error) throw error;
  }
}
