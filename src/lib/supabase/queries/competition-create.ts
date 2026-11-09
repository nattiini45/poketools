/**
 * The one write of the new-competition wizard: `competition_create_from_format`
 * (supabase/migrations/20261109120000_competition_create_from_format.sql), which creates a custom league from a format in one
 * transaction. Server only. The caller (`src/lib/format-studio/create-league.ts`) has resolved, compiled and planned
 * everything; this module passes it through and returns the raw database error unchanged, so the caller maps it.
 */
import 'server-only';

import { supabase } from '../client';
import type { Database, Json } from '@/types/database';
import type { Season } from '@/types/season';
import type { LText } from '@/lib/studio-core/ltext';
import type { ResolvedRules, RulesetDocument } from '@/lib/ruleset-kit/types';
import type { FormatDefinition } from '@/lib/format-kit/client';
import type { AttachStageRow } from './season-formats';
import { toSeason } from './seasons';

/** The league row to insert. `route_theme` and `language` are omitted to keep their column defaults. */
export interface CompetitionSeasonInput {
  id: string;
  name: string;
  description?: string;
  ruleset_id: string | null;
  start_date: string | null;
  end_date: string | null;
  route_theme?: string;
  language?: string;
}

/** A copy of a shipped example, inserted and published as version 1 by the function. */
export interface CompetitionForkInput {
  name: LText;
  description: LText | null;
  /** The draft the definition keeps (the example with `identity.based_on`). */
  document: Record<string, unknown>;
  /** Tried in order; the last one is inserted without a conflict clause, so a taken slug fails as `format_slug_taken`. */
  slug_candidates: string[];
}

export interface CompetitionFormatInput {
  definition_id: string;
  /** The published version to attach; omitted for a fork (the function publishes version 1). */
  version_no?: number;
  spec: FormatDefinition;
  spec_hash: string;
  seed: string;
  fork?: CompetitionForkInput;
}

/** One ruleset definition for a rule preset the stages name, published as version 1 for the new league. */
export interface CompetitionRulesetInput {
  /** The definition id; the planned preset stages carry it as their `ruleset_id` until the function pins the version. */
  id: string;
  preset: string;
  name: LText;
  slug_candidates: string[];
  document: RulesetDocument;
  content_hash: string;
  resolved: ResolvedRules;
  resolved_hash: string;
  catalog_version: string;
  changelog: LText | null;
}

export interface CompetitionCreateInput {
  actorId: string;
  season: CompetitionSeasonInput;
  format: CompetitionFormatInput;
  rulesets: CompetitionRulesetInput[];
  stages: AttachStageRow[];
  /** True for a creator who is not a site admin: the function makes them an admin of the new league. */
  grantCreator: boolean;
}

export interface CompetitionCreateResult {
  /** The league row as the function stored it. */
  season: Season;
  season_id: string;
  definition_id: string;
  version_no: number;
  stages: { id: string; key: string; group: number }[];
  ruleset_ids: string[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Creates the league, its format and its stages in one transaction. Throws the database error as it came. */
export async function createCompetitionFromFormat(input: CompetitionCreateInput): Promise<CompetitionCreateResult> {
  const { data, error } = await supabase.rpc('competition_create_from_format', {
    p_actor: input.actorId,
    p_season: input.season as unknown as Json,
    p_format: input.format as unknown as Json,
    p_rulesets: input.rulesets as unknown as Json,
    p_stages: input.stages as unknown as Json,
    p_grant_creator: input.grantCreator,
  });
  if (error) throw error;
  const result = (data ?? {}) as Record<string, unknown>;
  const seasonRow = result.season;
  if (
    typeof seasonRow !== 'object' ||
    seasonRow === null ||
    typeof result.season_id !== 'string' ||
    typeof result.definition_id !== 'string' ||
    typeof result.version_no !== 'number'
  ) {
    throw new Error('competition_create_from_format returned an unexpected shape');
  }
  const stages = Array.isArray(result.stages)
    ? (result.stages as Array<{ id?: unknown; key?: unknown; group?: unknown }>).flatMap((stage) =>
        typeof stage.id === 'string' && typeof stage.key === 'string'
          ? [{ id: stage.id, key: stage.key, group: typeof stage.group === 'number' ? stage.group : 0 }]
          : [],
      )
    : [];
  return {
    season: toSeason(seasonRow as Database['public']['Tables']['seasons']['Row']),
    season_id: result.season_id,
    definition_id: result.definition_id,
    version_no: result.version_no,
    stages,
    ruleset_ids: stringArray(result.ruleset_ids),
  };
}
