/**
 * Reads of the format engine: the attached format's engine and seed, the phases a kit league generated, the
 * outcomes of their matches and who plays in them. Server only.
 *
 * Every list read walks `.range()` pages (`readAllPages`), so a long season stays complete under `max_rows`; an
 * empty id list makes no request.
 */
import 'server-only';

import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import type { Json } from '@/types/database';
import { isMatchOutcomeKind, type MatchOutcomeKind } from '@/types/match-outcome';
import type { SeasonFormatEngine } from '@/lib/format-studio/library-types';
import { isValidUuid } from '@/lib/utils/uuid';

/** Ids per `.in()` filter. */
const IN_CHUNK = 100;

export interface SeasonKitHead {
  engine: SeasonFormatEngine;
  /** Server-side only: never hand it to a client. */
  seed: string;
}

/** The engine and seed of the league's attached format, or null when none is attached. */
export async function getSeasonKitHead(seasonId: string): Promise<SeasonKitHead | null> {
  if (!isValidUuid(seasonId)) return null;
  const { data, error } = await supabase.from('season_formats').select('engine, seed').eq('season_id', seasonId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const engine = data.engine === 'legacy' || data.engine === 'shadow' || data.engine === 'kit' ? data.engine : 'legacy';
  return { engine, seed: data.seed };
}

export interface KitPhaseRow {
  id: string;
  format_stage_key: string;
  stage_order: number | null;
  stage_spec: Json | null;
}

/** The phases the attached format generated (one per kit stage), in stage order. */
export async function getKitPhases(seasonId: string): Promise<KitPhaseRow[]> {
  if (!isValidUuid(seasonId)) return [];
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, format_stage_key, stage_order, stage_spec')
    .eq('season_id', seasonId)
    .not('format_stage_key', 'is', null)
    .order('stage_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((row) =>
    row.format_stage_key === null
      ? []
      : [{ id: row.id, format_stage_key: row.format_stage_key, stage_order: row.stage_order, stage_spec: row.stage_spec }],
  );
}

export interface PhaseOutcomeRow {
  match_id: string;
  tournament_id: string;
  kind: MatchOutcomeKind;
  p1_faints: number | null;
  p2_faints: number | null;
}

/** The outcome rows of every match of the phases, with the phase of the match. Reason and setter stay out. */
export async function getOutcomesByPhases(phaseIds: readonly string[]): Promise<PhaseOutcomeRow[]> {
  const ids = [...new Set(phaseIds)];
  const out: PhaseOutcomeRow[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const rows = await readAllPages((from, to) =>
      supabase
        .from('match_outcomes')
        .select('match_id, kind, p1_faints, p2_faints, matches!inner(tournament_id)')
        .in('matches.tournament_id', chunk)
        .order('match_id', { ascending: true })
        .range(from, to),
    );
    for (const row of rows) {
      if (!isMatchOutcomeKind(row.kind)) throw new Error(`match_outcomes ${row.match_id}: unknown kind ${row.kind}`);
      out.push({
        match_id: row.match_id,
        tournament_id: row.matches.tournament_id,
        kind: row.kind,
        p1_faints: row.p1_faints,
        p2_faints: row.p2_faints,
      });
    }
  }
  return out;
}

/** The id of every match of the phases, with its phase. */
export async function getPhaseMatchIds(phaseIds: readonly string[]): Promise<{ id: string; tournament_id: string }[]> {
  const ids = [...new Set(phaseIds)];
  const out: { id: string; tournament_id: string }[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const rows = await readAllPages((from, to) =>
      supabase
        .from('matches')
        .select('id, tournament_id')
        .in('tournament_id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
    );
    out.push(...rows);
  }
  return out;
}

/** Who plays in each phase (`tournament_participants`). */
export async function getPhaseMembers(phaseIds: readonly string[]): Promise<{ tournament_id: string; player_id: string }[]> {
  const ids = [...new Set(phaseIds)];
  const out: { tournament_id: string; player_id: string }[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const rows = await readAllPages((from, to) =>
      supabase
        .from('tournament_participants')
        .select('tournament_id, player_id')
        .in('tournament_id', chunk)
        .order('tournament_id', { ascending: true })
        .order('player_id', { ascending: true })
        .range(from, to),
    );
    out.push(...rows);
  }
  return out;
}
