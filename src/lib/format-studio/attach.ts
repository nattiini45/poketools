/**
 * Attach and detach: freezing a published format version onto a custom league and turning its stages into
 * `tournaments` rows. Server only.
 *
 * `attachFormatToSeason` checks, in this order and with bounded reads, before it writes anything: the league is
 * custom and has not started, the caller may attach the definition, the version exists and its stored spec still
 * hashes to the stored hash, the spec compiles without an error against the rulesets that exist, every
 * `season_default` stage has a league ruleset to fall back on, and the league has no hand-made phase. Only then
 * does one RPC (a single transaction that locks the league and repeats the started and manual-phase checks)
 * write the frozen spec, the stages and the readiness row. A refusal at any step calls no RPC.
 *
 * The caller (the route) expires the read cache and writes the audit event after the RPC commits; this module
 * returns the stage ids to expire.
 */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { CURRENT_ENV } from '@/lib/format-kit/engine/env';
import { contentHash } from '@/lib/format-kit/json';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getFormatDefinitionMeta, getFormatVersion, getLatestPublishedVersion } from '@/lib/supabase/queries/format-definitions';
import {
  attachSeasonFormat,
  detachSeasonFormat,
  getExistingRulesetIds,
  getSeasonFormatSummary,
  getSeasonManualPhaseCount,
  getSeasonStartSignals,
} from '@/lib/supabase/queries/season-formats';
import { isSeasonStarted } from '@/lib/season/season-started';
import type { SessionPlayer } from '@/types/auth';
import type { BracketType } from '@/types/tournament';
import type { SeasonFormatType } from '@/types/season';
import { canAttachDefinition, type FormatActor } from './access';
import { FormatStudioError } from './errors';
import type { EngineGap, SeasonFormatSummary } from './library-types';
import { planStages } from './materialise';

export interface AttachInput {
  actor: SessionPlayer;
  seasonId: string;
  definitionId: string;
  versionNo?: number;
}

export interface AttachedStage {
  id: string;
  key: string;
  bracket_type: BracketType;
  stage_order: number;
}

export interface AttachOutcome {
  /** True when the league already had a format and this attach replaced it. */
  replaced: boolean;
  season_format: SeasonFormatSummary;
  stages: AttachedStage[];
  warnings: EngineGap[];
  definition: { id: string; slug: string };
  version_no: number;
  spec_hash: string;
  /** Created, updated and removed stage ids: what the cache expiry needs. */
  touched_stage_ids: string[];
}

const toActor = (player: SessionPlayer): FormatActor => ({ playerId: player.playerId, isAdmin: player.isAdmin });

function seasonNotFound(): UserFacingError {
  return new UserFacingError('Season not found', { code: 'season_not_found', status: 404 });
}

/** The ids of the rulesets a spec names explicitly (a stored spec; read defensively). */
function namedRulesetIds(spec: FormatDefinition): string[] {
  const ids = new Set<string>();
  const stages: unknown = spec.stages;
  if (!Array.isArray(stages)) return [];
  for (const stage of stages) {
    const ruleset = (stage as { ruleset?: { kind?: unknown; id?: unknown } } | null)?.ruleset;
    if (ruleset?.kind === 'ruleset' && typeof ruleset.id === 'string') ids.add(ruleset.id);
  }
  return [...ids];
}

/** True when the stored spec still hashes to the hash stored beside it. */
function hashMatches(spec: FormatDefinition, stored: string): boolean {
  try {
    return contentHash(spec) === stored;
  } catch {
    return false;
  }
}

export async function attachFormatToSeason(input: AttachInput): Promise<AttachOutcome> {
  const { actor, seasonId, definitionId } = input;

  // 1. The league exists and uses a custom format.
  const season = await getSeasonById(seasonId);
  if (season === null) throw seasonNotFound();
  if (season.format_type !== 'custom') throw new FormatStudioError('format_season_not_custom');

  // 2. It has not started (the RPC repeats this under a row lock).
  const signals = await getSeasonStartSignals(seasonId);
  if (signals === null) throw seasonNotFound();
  if (isSeasonStarted(signals)) throw new FormatStudioError('format_season_started');

  // 3. The caller may attach this definition, and the version exists and is published.
  const meta = await getFormatDefinitionMeta(definitionId);
  if (meta === null) throw new FormatStudioError('format_not_found');
  if (!canAttachDefinition(toActor(actor), meta)) throw new FormatStudioError('format_attach_forbidden');
  const version =
    input.versionNo !== undefined
      ? await getFormatVersion(definitionId, input.versionNo)
      : await getLatestPublishedVersion(definitionId);
  if (version === null || version.status !== 'published') throw new FormatStudioError('format_not_published');

  // 4. The stored spec still hashes to the stored hash. A mismatch is a data fault, never a client error.
  if (!hashMatches(version.spec, version.content_hash)) {
    console.error(`[format-attach] integrity check failed for definition ${definitionId} version ${version.version_no}`);
    throw new Error('Stored format version failed its integrity check');
  }

  // 5. The spec compiles against the rulesets that exist. No roster size: the roster is not final before the
  // league starts, so size-dependent checks belong to the readiness checklist.
  const rulesetIds = await getExistingRulesetIds(namedRulesetIds(version.spec));
  // Loaded on demand: the guards below are imported by the generate routes, which never compile.
  const { compile } = await import('@/lib/format-kit/compile');
  const compiled = compile(version.spec, { ...CURRENT_ENV, rulesetIds });
  const firstError = compiled.diagnostics.find((d) => d.severity === 'error');
  if (firstError !== undefined || !compiled.ok || compiled.definition === null || compiled.graph === null || compiled.plan === null) {
    throw new FormatStudioError('format_attach_invalid', { first: firstError?.code ?? 'schema_refine' });
  }
  const definition = compiled.definition;

  // 6. Every stage that uses the league's default ruleset has one.
  if (season.ruleset_id === null) {
    const count = definition.stages.filter((stage) => stage.ruleset.kind === 'season_default').length;
    if (count > 0) throw new FormatStudioError('format_attach_ruleset_required', { count });
  }

  // 7. No hand-made phase (the RPC repeats this under the row lock).
  const manual = await getSeasonManualPhaseCount(seasonId);
  if (manual > 0) throw new FormatStudioError('format_attach_manual_phases', { count: manual });

  // 8. Plan the stages and write everything in one transaction.
  const planned = planStages({
    definition,
    graphOrder: compiled.graph.order,
    plan: compiled.plan,
    seasonRulesetId: season.ruleset_id,
    seasonLanguage: season.language,
    specHash: version.content_hash,
  });
  const result = await attachSeasonFormat({
    seasonId,
    definitionId,
    versionNo: version.version_no,
    spec: version.spec,
    specHash: version.content_hash,
    seed: randomBytes(16).toString('hex'),
    stages: planned.stages,
  });

  const rowByKey = new Map(planned.stages.map((row) => [row.key, row]));
  const stages: AttachedStage[] = [];
  for (const created of result.stages) {
    const row = rowByKey.get(created.key);
    if (row !== undefined) {
      stages.push({ id: created.id, key: created.key, bracket_type: row.bracket_type, stage_order: row.stage_order });
    }
  }
  stages.sort((a, b) => a.stage_order - b.stage_order);

  const summary = await getSeasonFormatSummary(seasonId);
  if (summary === null) throw new Error('Attached format row not found after attach');

  return {
    replaced: result.replaced,
    season_format: summary,
    stages,
    warnings: planned.warnings,
    definition: { id: meta.id, slug: meta.slug },
    version_no: version.version_no,
    spec_hash: version.content_hash,
    touched_stage_ids: [...result.stages.map((s) => s.id), ...result.removed_stage_ids],
  };
}

/** Removes the attached format and the stages it created, in one transaction. */
export async function detachFormatFromSeason(seasonId: string): Promise<{ removed_stage_ids: string[] }> {
  const result = await detachSeasonFormat(seasonId);
  return { removed_stage_ids: result.removed_stage_ids };
}

/**
 * The readiness pre-check of the generate routes: a custom league whose format is not attached cannot start.
 * The database trigger is the backstop for every path; this refuses before a round is written.
 */
export async function assertSeasonFormatAttached(seasonId: string): Promise<void> {
  if ((await getSeasonFormatSummary(seasonId)) === null) throw new FormatStudioError('format_not_attached');
}

/**
 * The `PATCH /api/seasons/[id]` guard: a switch to or from `custom` is refused while a format is attached or
 * after the league has started (`season_format_type_locked`). A change between the legacy types takes no extra
 * read and no new refusal. A league that does not exist is left to the update to report.
 */
export async function assertFormatTypeChangeAllowed(seasonId: string, next: SeasonFormatType): Promise<void> {
  const season = await getSeasonById(seasonId);
  if (season === null || season.format_type === next) return;
  if (season.format_type !== 'custom' && next !== 'custom') return;
  const [summary, signals] = await Promise.all([getSeasonFormatSummary(seasonId), getSeasonStartSignals(seasonId)]);
  if (summary !== null || (signals !== null && isSeasonStarted(signals))) {
    throw new FormatStudioError('season_format_type_locked');
  }
}
