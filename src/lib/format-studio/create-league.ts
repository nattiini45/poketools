/**
 * The new-competition wizard (`POST /api/seasons` with `from_format`): a custom league created from a format in ONE
 * transaction. Server only.
 *
 * Everything is checked, compiled and planned here before anything is written, in the order of `attachFormatToSeason`
 * (`./attach.ts`): the source (a shipped example, or a published format the caller may attach whose stored spec still
 * hashes to its hash), the rulesets the spec names (usable by the caller), the compile against them, the league's default
 * ruleset for `season_default` stages, the rule-preset rulesets (compiled for publish) and the stage plan. Ids are
 * generated up front, so the plan can reference the league and the preset rulesets before they exist. Then one database
 * function (`competition_create_from_format`) forks and publishes the example, publishes the preset rulesets, inserts the
 * league and the creator grant and runs `format_attach_season`: any failure rolls all of it back, so there is nothing
 * to clean up.
 *
 * A database refusal leaves as the typed error of the format or ruleset studio; any other database failure is logged
 * with the original error and answers `season_format_create_failed` (500, nothing was created).
 */
import 'server-only';

import { randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_CONTENT_LOCALE } from '@/i18n/config';
import { CURRENT_ENV, PRESETS, applyRulesetPreset, compile } from '@/lib/format-kit';
import { namedRulesetsOf, presetsOf } from '@/lib/format-kit/ruleset-presets';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logger } from '@/lib/logger';
import { getRulesetPreset } from '@/lib/pkmn/ruleset-preset-catalog';
import { compileForPublish } from '@/lib/ruleset-studio/compile.server';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { mapRulesetDbError } from '@/lib/ruleset-studio/errors';
import { canUseDefinitions } from '@/lib/ruleset-studio/guards';
import { presetRulesetName } from '@/lib/ruleset-studio/materialise';
import { slugFromName as rulesetSlugFromName } from '@/lib/ruleset-studio/slug';
import { extractIdentity } from '@/lib/studio-core/identity';
import { slugCandidates } from '@/lib/studio-core/insert-with-slug.server';
import { contentHash } from '@/lib/studio-core/json';
import { ltext } from '@/lib/studio-core/ltext';
import {
  createCompetitionFromFormat,
  type CompetitionForkInput,
  type CompetitionRulesetInput,
} from '@/lib/supabase/queries/competition-create';
import { getFormatDefinitionMeta, getFormatVersion, getLatestPublishedVersion } from '@/lib/supabase/queries/format-definitions';
import { resolveNamedRulesets } from '@/lib/supabase/queries/ruleset-definitions';
import { getSeasonFormatSummary } from '@/lib/supabase/queries/season-formats';
import type { SessionPlayer } from '@/types/auth';
import type { Season } from '@/types/season';
import type { AttachedStage } from './attach';
import { canAttachDefinition } from './access';
import { FormatStudioError, mapFormatDbError } from './errors';
import { toActor, withBasedOn } from './library';
import type { EngineGap } from './library-types';
import { engineGaps, planStages } from './materialise';
import { slugFromName } from './slug';

/** Where the league's format comes from: a shipped example (optionally with a rule preset on every stage), or a stored one. */
export type FromFormat = { preset_id: string; ruleset_preset_id?: string } | { definition_id: string; version_no?: number };

/** The league fields of the request (already validated); the league is always `custom`. */
export interface LeagueFields {
  name: string;
  description?: string;
  ruleset_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  route_theme?: string;
  language?: string;
}

export interface CreateLeagueInput {
  actor: SessionPlayer;
  season: LeagueFields;
  fromFormat: FromFormat;
}

export interface CreatedLeague {
  /** The league row as the transaction stored it. */
  season: Season;
  season_id: string;
  format: { definition_id: string; version_no: number };
  /** The example the format was forked from (null for a stored format). */
  preset_id: string | null;
  stages: AttachedStage[];
  warnings: EngineGap[];
  /** Every phase id the function created (one per stage and group): what the cache expiry needs. */
  stage_ids: string[];
  /** The ruleset definitions created for the rule-preset stages. */
  ruleset_ids: string[];
}

interface ResolvedSource {
  definitionId: string;
  spec: FormatDefinition;
  specHash: string;
  /** The published version to attach; null for a fork, which the function publishes as version 1. */
  versionNo: number | null;
  fork: CompetitionForkInput | null;
}

/** True when the stored spec still hashes to the hash stored beside it. */
function hashMatches(spec: FormatDefinition, stored: string): boolean {
  try {
    return contentHash(spec) === stored;
  } catch {
    return false;
  }
}

/** A shipped example as a fork to publish: the document the definition keeps, the compiled spec and its hash. */
function resolvePreset(presetId: string, rulesetPreset: string | undefined): ResolvedSource {
  const preset = PRESETS.find((entry) => entry.id === presetId);
  if (preset === undefined) throw new FormatStudioError('format_preset_not_found');
  const structure = rulesetPreset === undefined ? preset.definition : applyRulesetPreset(preset.definition, rulesetPreset, { retitle: true });
  const document = withBasedOn(structure as unknown as Record<string, unknown>, preset.id);
  // The publish gate of `library.publish`: the parsed definition and its canonical hash are what a version stores.
  const result = compile(document, CURRENT_ENV);
  if (!result.ok || result.definition === null || result.hash === null) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
    throw new FormatStudioError('format_publish_invalid', { count: Math.max(errors, 1) });
  }
  const identity = extractIdentity(document);
  if (identity.name === null) throw new FormatStudioError('format_document_name_required');
  return {
    definitionId: randomUUID(),
    spec: result.definition,
    specHash: result.hash,
    versionNo: null,
    fork: {
      name: identity.name,
      description: identity.description,
      document,
      slug_candidates: slugCandidates(slugFromName(rulesetPreset === undefined ? preset.id : `${preset.id}-${rulesetPreset}`)),
    },
  };
}

/** A stored format: the caller may attach it, the version is published and its spec is intact. */
async function resolveStored(actor: SessionPlayer, definitionId: string, versionNo: number | undefined): Promise<ResolvedSource> {
  const meta = await getFormatDefinitionMeta(definitionId);
  if (meta === null) throw new FormatStudioError('format_not_found');
  if (!canAttachDefinition(toActor(actor), meta)) throw new FormatStudioError('format_attach_forbidden');
  const version = versionNo !== undefined ? await getFormatVersion(definitionId, versionNo) : await getLatestPublishedVersion(definitionId);
  if (version === null || version.status !== 'published') throw new FormatStudioError('format_not_published');
  if (!hashMatches(version.spec, version.content_hash)) {
    logger.error('format-studio/create-league', 'stored format version failed its integrity check', {
      definitionId,
      versionNo: version.version_no,
    });
    throw new Error('Stored format version failed its integrity check');
  }
  return { definitionId, spec: version.spec, specHash: version.content_hash, versionNo: version.version_no, fork: null };
}

/** The ruleset of one rule preset for the new league, compiled for publish (the function publishes it as version 1). */
function presetRuleset(preset: string, leagueName: string): CompetitionRulesetInput {
  const known = getRulesetPreset(preset);
  if (known === undefined) throw new Error(`createLeagueFromFormat: unknown rule preset "${preset}"`);
  const name = presetRulesetName(leagueName, known.name);
  const compiled = compileForPublish(newRulesetDocument(name, 'en', preset));
  return {
    id: randomUUID(),
    preset,
    name: ltext('en', name),
    slug_candidates: slugCandidates(rulesetSlugFromName(`${leagueName} ${preset}`)),
    document: compiled.document,
    content_hash: compiled.contentHash,
    resolved: compiled.resolved,
    resolved_hash: compiled.resolvedHash,
    catalog_version: compiled.catalogVersion,
    changelog: ltext('en', `Created for the format of ${leagueName.trim()}`.slice(0, 200)),
  };
}

/** A database failure as the typed error of the studio that raised it, or the generic "nothing was created" (logged first). */
function mapCreateError(err: unknown): unknown {
  const format = mapFormatDbError(err);
  if (format !== err) return format;
  const ruleset = mapRulesetDbError(err);
  if (ruleset !== err) return ruleset;
  logger.error('format-studio/create-league', 'competition_create_from_format failed; the transaction rolled back', { error: err });
  return new UserFacingError('The league could not be created from this format. Nothing was created. Try again.', {
    code: 'season_format_create_failed',
    status: 500,
  });
}

export async function createLeagueFromFormat(input: CreateLeagueInput): Promise<CreatedLeague> {
  const { actor, season, fromFormat } = input;

  // 1. The source, without writing.
  const source =
    'preset_id' in fromFormat
      ? resolvePreset(fromFormat.preset_id, fromFormat.ruleset_preset_id)
      : await resolveStored(actor, fromFormat.definition_id, fromFormat.version_no);

  // 2. The rulesets the spec names are published and usable by the caller, and the spec compiles against them.
  const named = await resolveNamedRulesets(namedRulesetsOf(source.spec));
  if (!(await canUseDefinitions(actor, [...named.values()].map((ruleset) => ruleset.definition_id)))) {
    throw new FormatStudioError('format_attach_ruleset_forbidden');
  }
  const compiled = compile(source.spec, { ...CURRENT_ENV, rulesetIds: new Set(named.keys()) });
  const firstError = compiled.diagnostics.find((d) => d.severity === 'error');
  if (firstError !== undefined || !compiled.ok || compiled.definition === null || compiled.graph === null || compiled.plan === null) {
    throw new FormatStudioError('format_attach_invalid', { first: firstError?.code ?? 'schema_refine' });
  }
  const definition = compiled.definition;

  // 3. Every stage that uses the league's default ruleset has one.
  const seasonRulesetId = season.ruleset_id ?? null;
  if (seasonRulesetId === null) {
    const count = definition.stages.filter((stage) => stage.ruleset.kind === 'season_default').length;
    if (count > 0) throw new FormatStudioError('format_attach_ruleset_required', { count });
  }

  // 4. One ruleset per rule preset, then the plan. A preset stage carries its ruleset's DEFINITION id; the function swaps in
  // the version it publishes.
  const rulesets = presetsOf(definition).map((preset) => presetRuleset(preset, season.name));
  const planned = planStages({
    definition,
    graphOrder: compiled.graph.order,
    plan: compiled.plan,
    seasonRulesetId,
    namedRulesetVersionIds: new Map([...named].map(([id, ruleset]) => [id, ruleset.head_version_id] as const)),
    presetRulesetIds: new Map(rulesets.map((ruleset) => [ruleset.preset, ruleset.id] as const)),
    seasonLanguage: season.language === 'en' || season.language === 'de' ? season.language : DEFAULT_CONTENT_LOCALE,
    specHash: source.specHash,
  });

  // 5. One transaction.
  const seasonId = randomUUID();
  let result: Awaited<ReturnType<typeof createCompetitionFromFormat>>;
  try {
    result = await createCompetitionFromFormat({
      actorId: actor.playerId,
      season: {
        id: seasonId,
        name: season.name,
        ...(season.description !== undefined ? { description: season.description } : {}),
        ruleset_id: seasonRulesetId,
        start_date: season.start_date ?? null,
        end_date: season.end_date ?? null,
        ...(season.route_theme !== undefined ? { route_theme: season.route_theme } : {}),
        ...(season.language !== undefined ? { language: season.language } : {}),
      },
      format: {
        definition_id: source.definitionId,
        ...(source.versionNo !== null ? { version_no: source.versionNo } : {}),
        spec: source.spec,
        spec_hash: source.specHash,
        seed: randomBytes(16).toString('hex'),
        ...(source.fork !== null ? { fork: source.fork } : {}),
      },
      rulesets,
      stages: planned.stages,
      grantCreator: !actor.isAdmin,
    });
  } catch (err) {
    throw mapCreateError(err);
  }

  const rowByKey = new Map(planned.stages.map((row) => [row.key, row]));
  const stages: AttachedStage[] = [];
  for (const created of result.stages) {
    const row = rowByKey.get(created.key);
    if (row !== undefined) stages.push({ id: created.id, key: created.key, bracket_type: row.bracket_type, stage_order: row.stage_order });
  }
  stages.sort((a, b) => a.stage_order - b.stage_order);

  // The league exists from here on: a failed read of the engine must not turn the create into an error (a retry would make a
  // second league), so it falls back to every gap the plan found.
  let warnings: EngineGap[] = planned.warnings;
  try {
    const summary = await getSeasonFormatSummary(result.season_id);
    if (summary !== null) warnings = engineGaps(planned.warnings, summary.engine);
  } catch (err) {
    logger.warn('format-studio/create-league', 'engine read after the create failed; reporting every engine gap', {
      seasonId: result.season_id,
      error: err,
    });
  }
  return {
    season: result.season,
    season_id: result.season_id,
    format: { definition_id: result.definition_id, version_no: result.version_no },
    preset_id: 'preset_id' in fromFormat ? fromFormat.preset_id : null,
    stages,
    warnings,
    stage_ids: result.stages.map((stage) => stage.id),
    ruleset_ids: result.ruleset_ids,
  };
}
