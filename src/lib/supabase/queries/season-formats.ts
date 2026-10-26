/**
 * Queries behind attaching a format to a custom league (`season_formats`, the generated stages in `tournaments`).
 * Server only.
 *
 * Reads name their columns (the summary read never selects the spec or the seed), id lists are chunked by 50 and an
 * empty list makes no request. The writes are the two Postgres functions `format_attach_season` and
 * `format_detach_season` (one transaction each); their database signals leave this module as typed errors through
 * `mapFormatDbError`. `season_formats.showdown_rulesets` records the rulesets an attach created for the format's
 * Showdown stages ({ showdown format id: ruleset id }); the two functions delete the ones a re-attach or a detach
 * leaves unused.
 */
import 'server-only';

import { supabase } from '../client';
import type { Json } from '@/types/database';
import type { BracketType } from '@/types/tournament';
import type { FormatDefinition } from '@/lib/format-kit/client';
import { mapFormatDbError } from '@/lib/format-studio/errors';
import type {
  SeasonFormatEngine,
  SeasonFormatRow,
  SeasonFormatSummary,
  StageSpecSnapshot,
} from '@/lib/format-studio/library-types';
import type { SeasonStartSignals } from '@/lib/season/season-started';
import { isValidUuid } from '@/lib/utils/uuid';

/** Ids per `.in(...)` filter. */
const BATCH_IDS = 50;

const SUMMARY_COLUMNS = 'season_id, definition_id, version_no, spec_hash, tunables, engine, frozen_at, amendments';

interface SummaryRow {
  season_id: string;
  definition_id: string | null;
  version_no: number;
  spec_hash: string;
  tunables: Json;
  engine: string;
  frozen_at: string;
  amendments: Json;
}

function toSummary(row: SummaryRow): SeasonFormatSummary {
  return {
    season_id: row.season_id,
    definition_id: row.definition_id,
    version_no: row.version_no,
    spec_hash: row.spec_hash,
    tunables: row.tunables as Record<string, unknown>,
    engine: row.engine as SeasonFormatEngine,
    frozen_at: row.frozen_at,
    amendments: Array.isArray(row.amendments) ? (row.amendments as unknown[]) : [],
  };
}

/** The attached format of a league without its spec and seed, or null when none is attached. */
export async function getSeasonFormatSummary(seasonId: string): Promise<SeasonFormatSummary | null> {
  if (!isValidUuid(seasonId)) return null;
  const { data, error } = await supabase
    .from('season_formats')
    .select(SUMMARY_COLUMNS)
    .eq('season_id', seasonId)
    .maybeSingle();
  if (error) throw error;
  return data ? toSummary(data as unknown as SummaryRow) : null;
}

/**
 * The rulesets the league's attach created for its Showdown stages, as { showdown format id: ruleset id }; empty
 * when no format is attached or it has no Showdown stage.
 */
export async function getSeasonShowdownRulesets(seasonId: string): Promise<Record<string, string>> {
  if (!isValidUuid(seasonId)) return {};
  const { data, error } = await supabase
    .from('season_formats')
    .select('showdown_rulesets')
    .eq('season_id', seasonId)
    .maybeSingle();
  if (error) throw error;
  const recorded = data?.showdown_rulesets;
  if (typeof recorded !== 'object' || recorded === null || Array.isArray(recorded)) return {};
  const out: Record<string, string> = {};
  for (const [format, id] of Object.entries(recorded)) {
    if (typeof id === 'string' && isValidUuid(id)) out[format] = id;
  }
  return out;
}

/** The full attached row, spec and seed included. For the engine and the admin spec view only. */
export async function getSeasonFormat(seasonId: string): Promise<SeasonFormatRow | null> {
  if (!isValidUuid(seasonId)) return null;
  const { data, error } = await supabase
    .from('season_formats')
    .select(`${SUMMARY_COLUMNS}, spec, seed`)
    .eq('season_id', seasonId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as SummaryRow & { spec: Json; seed: string };
  return { ...toSummary(row), spec: row.spec as unknown as FormatDefinition, seed: row.seed };
}

/** `child ( count )` embeds arrive as `[{ count: n }]`. */
function embeddedCount(value: unknown): number {
  if (!Array.isArray(value) || value.length === 0) return 0;
  const first = value[0] as { count?: unknown };
  return typeof first.count === 'number' ? first.count : 0;
}

/**
 * What `isSeasonStarted` needs, in one read: the league status and, per phase, its status and round count
 * (`rounds ( count )` embed). Null when the league does not exist.
 */
export async function getSeasonStartSignals(seasonId: string): Promise<SeasonStartSignals | null> {
  if (!isValidUuid(seasonId)) return null;
  const { data, error } = await supabase
    .from('seasons')
    .select('status, tournaments ( status, rounds ( count ) )')
    .eq('id', seasonId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const phases = (data.tournaments ?? []) as unknown as Array<{ status: string; rounds: unknown }>;
  return {
    status: data.status,
    phases: phases.map((phase) => ({
      status: phase.status as SeasonStartSignals['phases'][number]['status'],
      rounds_total: embeddedCount(phase.rounds),
    })),
  };
}

/** Phases of the league that were not created from a format (`format_stage_key` is null): head count. */
export async function getSeasonManualPhaseCount(seasonId: string): Promise<number> {
  if (!isValidUuid(seasonId)) return 0;
  const { count, error } = await supabase
    .from('tournaments')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
    .is('format_stage_key', null);
  if (error) throw error;
  return count ?? 0;
}

/** Which of `ids` are rulesets that exist. Chunks of 50; an empty (or all-malformed) list makes no request. */
export async function getExistingRulesetIds(ids: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(ids)].filter((id) => isValidUuid(id));
  for (let i = 0; i < unique.length; i += BATCH_IDS) {
    const chunk = unique.slice(i, i + BATCH_IDS);
    const { data, error } = await supabase.from('rulesets').select('id').in('id', chunk);
    if (error) throw error;
    for (const row of data ?? []) found.add(row.id);
  }
  return found;
}

/** One generated stage, as `format_attach_season` reads it (a `tournaments` row to upsert by `(season_id, key)`). */
export interface AttachStageRow {
  key: string;
  name: string;
  bracket_type: BracketType;
  ruleset_id: string;
  best_of_default: number;
  bo_overrides: Record<string, number>;
  is_doubles: boolean;
  bracket_reset_enabled: boolean;
  stage_order: number;
  stage_spec: StageSpecSnapshot;
}

export interface AttachRpcInput {
  seasonId: string;
  definitionId: string;
  versionNo: number;
  spec: FormatDefinition;
  specHash: string;
  seed: string;
  stages: AttachStageRow[];
  /** { showdown format id: ruleset id } of the Showdown stages; `{}` when the spec has none. */
  showdownRulesets: Readonly<Record<string, string>>;
}

export interface AttachRpcResult {
  replaced: boolean;
  stages: { id: string; key: string }[];
  removed_stage_ids: string[];
  /** Rulesets the previous attach created that the new one no longer uses (deleted by the function). */
  removed_ruleset_ids: string[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Attach (or re-attach) a format version to a custom league: frozen copy plus one phase per stage, one transaction. */
export async function attachSeasonFormat(input: AttachRpcInput): Promise<AttachRpcResult> {
  const { data, error } = await supabase.rpc('format_attach_season', {
    p_season_id: input.seasonId,
    p_definition_id: input.definitionId,
    p_version_no: input.versionNo,
    p_spec: input.spec as unknown as Json,
    p_spec_hash: input.specHash,
    p_seed: input.seed,
    p_stages: input.stages as unknown as Json,
    p_showdown_rulesets: input.showdownRulesets as unknown as Json,
  });
  if (error) throw mapFormatDbError(error);
  const result = (data ?? {}) as {
    replaced?: unknown;
    stages?: unknown;
    removed_stage_ids?: unknown;
    removed_ruleset_ids?: unknown;
  };
  const stages = Array.isArray(result.stages)
    ? (result.stages as Array<{ id?: unknown; key?: unknown }>).flatMap((stage) =>
        typeof stage.id === 'string' && typeof stage.key === 'string' ? [{ id: stage.id, key: stage.key }] : [],
      )
    : [];
  return {
    replaced: result.replaced === true,
    stages,
    removed_stage_ids: stringArray(result.removed_stage_ids),
    removed_ruleset_ids: stringArray(result.removed_ruleset_ids),
  };
}

export interface DetachRpcResult {
  removed_stage_ids: string[];
  /** The rulesets the attach had created that nothing points at any more (deleted by the function). */
  removed_ruleset_ids: string[];
}

/** Remove the attached format, the phases created from it and the rulesets it created, one transaction. */
export async function detachSeasonFormat(seasonId: string): Promise<DetachRpcResult> {
  const { data, error } = await supabase.rpc('format_detach_season', { p_season_id: seasonId });
  if (error) throw mapFormatDbError(error);
  const result = (data ?? {}) as { removed_stage_ids?: unknown; removed_ruleset_ids?: unknown };
  return {
    removed_stage_ids: stringArray(result.removed_stage_ids),
    removed_ruleset_ids: stringArray(result.removed_ruleset_ids),
  };
}
