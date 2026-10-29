import 'server-only';
/**
 * Ruleset previews (plan 3.6.3, P): `ruleset_build_preview`, `ruleset_test_team`, `ruleset_publish_preview`,
 * `ruleset_pin_impact_preview`. Pure computation and reads; nothing is written.
 *
 * The build preview assembles an UNSAVED `RulesetDocument` with the kit's own pure edit operations and compiles it with
 * the server compile (`compileDocument`), so the diagnostics, the `unknown_entry` warning and the enforced-versus-
 * informational split are exactly what a publish would see. `unknown_entry` is a warning for the route (it does not
 * block a publish), so the preflight here promotes it to the blocker `ban_name_unresolved`.
 */
import { z } from 'zod';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { applyTourOverlay } from '@/lib/ruleset-kit/overlay';
import { banEntries, allowEntries, resetEntries, setClause, setMode } from '@/lib/ruleset-kit/ops';
import { computeEffective, diffResolved } from '@/lib/ruleset-kit/effective';
import { RULESET_CATEGORIES, type RulesetCategory, type RulesetDocument } from '@/lib/ruleset-kit/types';
import { toID } from '@/lib/pkmn/i18n/id';
import { getPreset } from '@/lib/pkmn/format-catalog';
import { isRulesetPresetId } from '@/lib/pkmn/ruleset-preset-catalog';
import { resolvePresetRules, resolveTourOverlay } from '@/lib/pkmn/preset-rules.server';
import { validateTeam } from '@/lib/pkmn/validation';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { compileDocument } from '@/lib/ruleset-studio/compile.server';
import { describeResolved } from '@/lib/ruleset-studio/describe.server';
import { getRulesetDetail } from '@/lib/ruleset-studio/library';
import { computePinImpact } from '@/lib/ruleset-studio/pin-impact.server';
import { toRulesetView } from '@/lib/ruleset-studio/view';
import { getRulesetVersion } from '@/lib/supabase/queries/ruleset-definitions';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { Json } from '@/types/database';
import type { PokemonSet } from '@/types/team';
import { defineRunnable } from '../registry/define';
import { capped, code, id, intArg, label, textArg, userText, uuidArg } from '../registry/atoms';
import { fenceLabel, fenceText } from '../registry/fence';
import { checkOut, toCheckOut } from '../registry/projections';
import { finding, finder } from './shared';

const IDS_PER_EDIT = 300;
const CHANGE_IDS_CAP = 60;
const SECTION_CAP = 12;
const ISSUE_CAP = 40;
const PIN_TARGETS_MAX = 50;
/** `POST .../pins/impact` limits: 60 per hour per player, shared with the human UI. */
const PIN_IMPACT_LIMIT = { limit: 60, windowSeconds: 60 * 60 } as const;

const text = z.string().regex(/^[\p{L}\p{N}\p{P}\p{Zs}+%&]{1,500}$/u);

// ─── ruleset_build_preview ───────────────────────────────────────────────────

const editSchema = z.strictObject({
  category: z.enum(RULESET_CATEGORIES),
  action: z.enum(['ban', 'unban', 'allow_only', 'reset']).describe('ban: make the ids illegal; unban: make them legal; allow_only: only these ids are legal in the category; reset: back to what the base says'),
  ids: z.array(z.string().trim().min(1).max(60)).max(IDS_PER_EDIT).describe('Dex ids or names, up to 300'),
});

const changeList = z.strictObject({
  category: z.enum(RULESET_CATEGORIES),
  mode_changed: z.boolean(),
  added_count: z.number().int(),
  removed_count: z.number().int(),
  added: z.array(code()),
  removed: z.array(code()),
});

function listOfCategory(preset: ReturnType<typeof resolvePresetRules>, category: RulesetCategory) {
  return preset === null ? null : preset[category];
}

const rulesetBuildPreviewArgs = z.strictObject({
  name: textArg('Working title', 80).optional(),
  base_preset: textArg('Catalog preset id such as gen9ou; leave out for a blank base', 60).optional(),
  blank_gen: intArg('Generation of a blank base', 1, 9).optional(),
  blank_doubles: z.boolean().optional(),
  blank_universe: z.enum(['standard', 'national']).optional(),
  tour_overlay: z.boolean().optional().describe('Add the preset\'s documented Smogon tour clauses and bans'),
  edits: z.array(editSchema).max(24).optional(),
  clauses_add: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  clauses_remove: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  min_shared_type_pct: intArg('Minimum share of the team that must share a type', 0, 100).optional(),
});
export type RulesetBuildPreviewArgs = z.output<typeof rulesetBuildPreviewArgs>;

/**
 * What `ruleset_build_preview` answers. Pure and port-free (the kit's edit operations and the server compile, nothing
 * that reads or writes), so the plan-stage eval world runs the very same code.
 */
export function buildRulesetPreview(args: RulesetBuildPreviewArgs, locale: 'en' | 'de') {
  const empty = {
    built: false,
    blockers: [] as Array<z.infer<typeof finding>>,
    base: { kind: 'blank' as const, preset: null, gen: null, doubles: null, universe: null },
    check: null,
    informational_clauses: [] as string[],
    sections: { items: [], total: 0, truncated: false, cap: SECTION_CAP },
    coverage: null,
    changes_vs_base: { categories: [], clauses_added: [], clauses_removed: [], other_changed: false },
  };

  if (args.base_preset !== undefined && !isRulesetPresetId(args.base_preset)) {
    return { ...empty, blockers: [finder('base_format_unknown', { preset: args.base_preset })] };
  }
  const presetId = args.base_preset;
  const preset = presetId === undefined ? null : resolvePresetRules(presetId);
  if (presetId !== undefined && preset === null) {
    return { ...empty, blockers: [finder('base_format_unknown', { preset: presetId })] };
  }

  let doc: RulesetDocument = newRulesetDocument(args.name ?? 'Preview', locale, presetId);
  if (presetId === undefined) {
    doc = { ...doc, base: { kind: 'blank', gen: args.blank_gen ?? 9, doubles: args.blank_doubles ?? false, universe: args.blank_universe ?? 'standard' } };
  }
  const baseline = doc;

  const blockers: Array<z.infer<typeof finding>> = [];
  if (args.tour_overlay === true) {
    const overlay = presetId === undefined ? null : resolveTourOverlay(presetId);
    if (overlay === null || preset === null) blockers.push(finder('ruleset_preset_unknown'));
    else doc = applyTourOverlay(doc, overlay, preset).document;
  }
  for (const edit of args.edits ?? []) {
    const ids = edit.ids.map(toID).filter((entry) => entry !== '');
    const base = listOfCategory(preset, edit.category);
    if (edit.action === 'ban') doc = banEntries(doc, edit.category, ids, base).doc;
    else if (edit.action === 'unban') doc = allowEntries(doc, edit.category, ids, base).doc;
    else if (edit.action === 'reset') doc = resetEntries(doc, edit.category, ids, base).doc;
    else doc = setMode(doc, edit.category, 'allow', ids);
  }
  const presetClauses = preset?.clauses ?? [];
  for (const clause of args.clauses_add ?? []) doc = setClause(doc, toID(clause), true, presetClauses);
  for (const clause of args.clauses_remove ?? []) doc = setClause(doc, toID(clause), false, presetClauses);
  if (args.min_shared_type_pct !== undefined) doc = { ...doc, min_shared_type_pct: args.min_shared_type_pct };

  const { result } = compileDocument(doc);
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.code === 'unknown_entry') {
      blockers.push(finder('ban_name_unresolved', { path: diagnostic.path, ...(diagnostic.params ?? {}) }));
    }
  }
  const informational = result.diagnostics
    .filter((d) => d.code === 'clause_informational')
    .map((d) => String(d.params?.id ?? ''))
    .filter((entry) => /^[a-z0-9]{1,60}$/.test(entry));

  const baseKind = doc.base.kind === 'preset' ? ('preset' as const) : ('blank' as const);
  const described =
    result.resolved === null ? null : describeResolved(result.resolved, locale, presetId === undefined ? null : (getPreset(presetId)?.name ?? presetId));
  const baselineRules = result.resolved === null ? null : computeEffective(baseline, preset);
  const diff = result.resolved === null || baselineRules === null ? null : diffResolved(baselineRules, result.resolved);

  return {
    built: result.ok,
    blockers,
    base: {
      kind: baseKind,
      preset: doc.base.kind === 'preset' ? doc.base.preset : null,
      gen: result.resolved?.gen ?? (doc.base.kind === 'blank' ? doc.base.gen : null),
      doubles: result.resolved?.doubles ?? null,
      universe: result.resolved?.universe ?? null,
    },
    check: toCheckOut(result),
    informational_clauses: informational,
    sections: {
      items: (described?.sections ?? []).slice(0, SECTION_CAP).map((section) => ({
        id: section.id,
        heading: section.heading,
        lines: section.lines.map((line) => fenceText(line)),
      })),
      total: described?.sections.length ?? 0,
      truncated: (described?.sections.length ?? 0) > SECTION_CAP,
      cap: SECTION_CAP,
    },
    coverage: described === null ? null : described.coverage,
    changes_vs_base:
      diff === null
        ? empty.changes_vs_base
        : {
            categories: RULESET_CATEGORIES.map((category) => ({
              category,
              mode_changed: diff[category].modeChanged,
              added_count: diff[category].added.length,
              removed_count: diff[category].removed.length,
              added: diff[category].added.slice(0, CHANGE_IDS_CAP),
              removed: diff[category].removed.slice(0, CHANGE_IDS_CAP),
            })),
            clauses_added: diff.clausesAdded,
            clauses_removed: diff.clausesRemoved,
            other_changed: diff.otherChanged,
          },
  };
}

export const rulesetBuildPreview = defineRunnable('any', {
  name: 'ruleset_build_preview',
  class: 'P',
  description:
    'Preview a ruleset without saving anything: start from a catalog preset (base_preset) or a blank base (blank_gen, blank_doubles, blank_universe), optionally add the Smogon tour extras, then apply edits (ban, unban, allow_only, reset per category) and clause changes. Returns the compile diagnostics exactly as a publish would see them, bans that match no dex entry as blockers, which clauses are only informational (shown, not enforced), the rules as sentences, and what changed against the base. Use dex ids or exact names from dex_lookup; banning a base species does not ban its other formes.',
  args: rulesetBuildPreviewArgs,
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    built: z.boolean(),
    blockers: z.array(finding),
    base: z.strictObject({ kind: z.enum(['preset', 'blank']), preset: code().nullable(), gen: z.number().int().nullable(), doubles: z.boolean().nullable(), universe: z.enum(['standard', 'national']).nullable() }),
    check: checkOut.nullable(),
    informational_clauses: z.array(code()),
    sections: capped(z.strictObject({ id: code(), heading: text, lines: z.array(text) })),
    coverage: text.nullable(),
    changes_vs_base: z.strictObject({
      categories: z.array(changeList),
      clauses_added: z.array(code()),
      clauses_removed: z.array(code()),
      other_changed: z.boolean(),
    }),
  }),
  async execute(args, _guarded, ctx) {
    return buildRulesetPreview(args, ctx.locale);
  },
});

// ─── ruleset_test_team ───────────────────────────────────────────────────────

const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const PERFECT = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

const memberSchema = z.strictObject({
  species: textArg('Species name', 60),
  item: z.string().trim().max(60).optional(),
  ability: z.string().trim().max(60).optional(),
  moves: z.array(z.string().trim().min(1).max(60)).max(4).optional(),
});

export const rulesetTestTeam = defineRunnable('rulesetViewer', {
  name: 'ruleset_test_team',
  class: 'P',
  description:
    'Check a sample team against a ruleset to see whether its rules do what the admin intends. Give the ruleset definition id and a team of 1 to 6 Pokémon (species, optional item, ability and up to 4 moves). With version_no the team is checked against that published version\'s frozen rules; without it, against the compiled private draft (only the owner and league admins of a league-owned ruleset may do that). Returns valid and the issues with their codes. Nothing is saved.',
  args: z.strictObject({
    ruleset_id: uuidArg('Ruleset definition id'),
    version_no: intArg('Published version number; omit to test the draft', 1, 100_000).optional(),
    team: z.array(memberSchema).min(1).max(6),
  }),
  phase: 0,
  guard: (args) => ({ kind: 'rulesetViewer', id: args.ruleset_id }),
  output: z.strictObject({
    tested: z.enum(['version', 'draft']),
    valid: z.boolean(),
    issues: capped(z.strictObject({ pokemon_index: z.number().int(), species_label: label(), severity: z.enum(['error', 'warning']), code: code().nullable(), detail_user_text: userText() })),
    team_issues: capped(z.strictObject({ code: code().nullable(), detail_user_text: userText() })),
  }),
  async execute(args, guarded) {
    const { definition, actor } = guarded.ruleset;
    let resolved: unknown;
    let tested: 'version' | 'draft';
    let versionNo = 0;
    if (args.version_no !== undefined) {
      const version = await getRulesetVersion(definition.id, args.version_no);
      if (version === null) throw new UserFacingError('Ruleset not found', { code: 'ruleset_not_found', status: 404 });
      resolved = version.resolved;
      versionNo = version.version_no;
      tested = 'version';
    } else {
      const detail = await getRulesetDetail(actor, definition);
      if (detail.draft === null) throw new UserFacingError('Forbidden', { code: 'forbidden', status: 403 });
      const compiled = compileDocument(detail.draft.document).result;
      if (!compiled.ok || compiled.resolved === null) {
        return {
          tested: 'draft' as const,
          valid: false,
          issues: { items: [], total: 0, truncated: false, cap: ISSUE_CAP },
          team_issues: { items: [{ code: 'ruleset_document_invalid', detail_user_text: '' }], total: 1, truncated: false, cap: ISSUE_CAP },
        };
      }
      resolved = compiled.resolved;
      tested = 'draft';
    }
    const ruleset = toRulesetView({
      id: definition.id,
      definition_id: definition.id,
      version_no: versionNo,
      name_text: 'preview',
      resolved: resolved as Json,
      created_by: null,
      created_at: new Date(0).toISOString(),
    });
    const team: PokemonSet[] = args.team.map((member) => ({
      name: '',
      species: member.species,
      gender: '',
      item: member.item ?? '',
      ability: member.ability ?? '',
      evs: { ...ZERO },
      ivs: { ...PERFECT },
      nature: 'Hardy',
      level: 100,
      moves: member.moves ?? [],
    }));
    const outcome = validateTeam(team, ruleset);
    const issues = outcome.issues.map((issue) => ({
      pokemon_index: issue.pokemon_index,
      species_label: fenceLabel(issue.species),
      severity: issue.severity,
      code: issue.code ?? null,
      detail_user_text: fenceText(JSON.stringify(issue.params ?? {})),
    }));
    const details = outcome.team_issue_details ?? outcome.team_issues.map((entry) => ({ issue: entry, code: undefined, params: undefined }));
    const teamIssues = details.map((detail) => ({ code: detail.code ?? null, detail_user_text: fenceText(JSON.stringify(detail.params ?? {})) }));
    return {
      tested,
      valid: outcome.valid,
      issues: { items: issues.slice(0, ISSUE_CAP), total: issues.length, truncated: issues.length > ISSUE_CAP, cap: ISSUE_CAP },
      team_issues: { items: teamIssues.slice(0, ISSUE_CAP), total: teamIssues.length, truncated: teamIssues.length > ISSUE_CAP, cap: ISSUE_CAP },
    };
  },
});

// ─── ruleset_publish_preview ─────────────────────────────────────────────────

export const rulesetPublishPreview = defineRunnable('rulesetOwner', {
  name: 'ruleset_publish_preview',
  class: 'P',
  description:
    'Preview publishing the private draft of a ruleset: whether it would publish (an error diagnostic blocks it), its current draft revision, which diagnostics remain and what the published version would be. Publishing creates an immutable version that can never be edited or removed from a league that pins it. Only the owner, league admins of a league-owned ruleset and site admins can preview a draft. Nothing is written.',
  args: z.strictObject({ ruleset_id: uuidArg('Ruleset definition id') }),
  phase: 0,
  guard: (args) => ({ kind: 'rulesetOwner', id: args.ruleset_id }),
  output: z.strictObject({
    draft_rev: z.number().int(),
    publishable: z.boolean(),
    check: checkOut,
    visibility: z.enum(['private', 'league', 'gallery']),
    has_published_version: z.boolean(),
    selectable_by_other_admins: z.boolean(),
  }),
  async execute(_args, guarded) {
    const { definition, actor } = guarded.ruleset;
    const detail = await getRulesetDetail(actor, definition);
    if (detail.draft === null || detail.check === null) throw new UserFacingError('Forbidden', { code: 'forbidden', status: 403 });
    return {
      draft_rev: detail.draft.draft_rev,
      publishable: detail.check.ok,
      check: toCheckOut(detail.check),
      visibility: definition.visibility,
      has_published_version: detail.published !== null,
      selectable_by_other_admins: definition.visibility !== 'private',
    };
  },
});

// ─── ruleset_pin_impact_preview ──────────────────────────────────────────────

export const rulesetPinImpactPreview = defineRunnable('rulesetViewer', {
  name: 'ruleset_pin_impact_preview',
  class: 'P',
  description:
    'Ask how many already-submitted teams of the named leagues and phases would stop being valid if their ruleset pin moved to another published version of this ruleset. Same targets and access as the pin move: the admin must administer every target, and a finished target is refused. At most 2,000 teams are checked; truncated says the bound was reached. It uses the same hourly limit as the admin page (60 per hour). Nothing is written. Read it before proposing a pin move.',
  args: z.strictObject({
    ruleset_id: uuidArg('Ruleset definition id'),
    to_version_no: intArg('Version number to move to', 1, 100_000),
    targets: z
      .array(z.strictObject({ kind: z.enum(['season', 'tournament']), id: uuidArg('League or phase id') }))
      .min(1)
      .max(PIN_TARGETS_MAX)
      .refine((targets) => new Set(targets.map((t) => `${t.kind}:${t.id}`)).size === targets.length, { message: 'A league or phase may be listed only once' }),
  }),
  phase: 0,
  guard: (args) => ({ kind: 'rulesetViewer', id: args.ruleset_id }),
  output: z.strictObject({
    version_no: z.number().int(),
    checked: z.number().int(),
    would_break: z.number().int(),
    truncated: z.boolean(),
    targets: capped(z.strictObject({ kind: z.enum(['season', 'tournament']), id: id(), label: label(), checked: z.number().int(), would_break: z.number().int() })),
  }),
  async execute(args, guarded) {
    const rate = await checkRateLimit('ruleset-pin-impact', guarded.player.playerId, PIN_IMPACT_LIMIT);
    if (!rate.allowed) {
      throw new UserFacingError('Rate limit exceeded', { code: 'rate_limited', params: { seconds: rate.retryAfterSeconds }, status: 429 });
    }
    const impact = await computePinImpact({
      actor: guarded.player,
      definition: guarded.ruleset.definition,
      toVersionNo: args.to_version_no,
      targets: args.targets,
    });
    return {
      version_no: impact.version_no,
      checked: impact.checked,
      would_break: impact.would_break,
      truncated: impact.truncated,
      targets: {
        items: impact.targets.map((t) => ({ kind: t.kind, id: t.id, label: fenceLabel(t.name), checked: t.checked, would_break: t.would_break })),
        total: impact.targets.length,
        truncated: false,
        cap: PIN_TARGETS_MAX,
      },
    };
  },
});

export const RULESET_PREVIEWS = [rulesetBuildPreview, rulesetTestTeam, rulesetPublishPreview, rulesetPinImpactPreview] as const;
