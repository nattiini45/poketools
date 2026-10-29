/**
 * The Plan document, version 1 (plan 4.3, spec §18.3): what the admin and the assistant currently intend. It has no
 * side effect on any live table; `deriveSteps` (./steps.ts) turns a ready Plan into the Build saga.
 *
 * Pure and client-safe (zod and shared constants only), so the Plan panel may import the types. Every object is
 * `.strict()`: a key the Plan does not know is a validation issue, never silently dropped (the parity test in
 * ./parity.ts relies on that to keep the Plan and the route schemas aligned).
 *
 * Two kinds of problem, on purpose:
 *  - a schema ISSUE means the document cannot be stored (wrong shape, self-contradictory, duplicate key);
 *  - a readiness BLOCKER (./readiness.ts) means the document is well formed but cannot be built yet.
 * Issue codes are machine codes (`plan_key_invalid`, zod's own issue codes), never prose: nothing in here reaches the
 * model as free text.
 */
import { z } from 'zod';
import { LOCALES } from '@/i18n/config';
import { LEGACY_POINTS_MAX } from '@/lib/draft/points-limits';
import { DRAFT_CONFIG_LIMITS } from '@/lib/draft/schemas';
import { MAX_CLAUSE_IDS, MAX_ID_LENGTH, MAX_IDS_PER_LIST, MAX_NAME_CHARS } from '@/lib/ruleset-kit/limits';
import { inspectJson, type JsonValue } from '@/lib/studio-core/json';
import {
  FIELD_LIMITS,
  bestOfSchema,
  bracketTypeSchema,
  contentLanguageSchema,
  draftPickOrderSchema,
  draftTypeSchema,
  seasonFormatTypeSchema,
  teamVisibilitySchema,
} from '@/lib/validation/schemas';

export const PLAN_VERSION = 1 as const;

/** Bounds that keep a Plan (and with it the Build) small. The route schemas enforce their own, wider limits. */
export const PLAN_LIMITS = {
  phases: 10,
  rosterEntries: 256,
  draftPools: 26,
  assumptions: 40,
  boOverrides: 32,
  candidates: 10,
  /** `serpentine` groups: `MIN_SEASON_GROUPS` / `MAX_SEASON_GROUPS` of the groups route (a parity test pins both). */
  groupsMin: 2,
  groupsMax: 26,
  /** The most bytes one assumption value may take in canonical JSON. */
  assumptionValueBytes: 2048,
  /** The most bytes a ruleset `team_constraints` object may take in canonical JSON. */
  teamConstraintsBytes: 4096,
} as const;

// ─── Building blocks ─────────────────────────────────────────────────

const uuid = z.uuid();
const nameSchema = z.string().trim().min(1).max(FIELD_LIMITS.TITLE);
const descriptionSchema = z.string().max(FIELD_LIMITS.LONG_TEXT);

/** A stable handle inside the Plan (phase key). Not a database value. */
export const PLAN_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const keySchema = z.string().regex(PLAN_KEY_PATTERN, { message: 'plan_key_invalid' });

/** The label of a league group: `Group A` is key `A`. */
export const GROUP_KEY_PATTERN = /^[A-Z]$/;
const groupKeySchema = z.string().regex(GROUP_KEY_PATTERN, { message: 'group_key_invalid' });

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

// ─── Ruleset delta (plan 4.3 "RulesetDocumentDelta") ─────────────────

/** A dex id (`toID`): lower-case letters and digits, never a display name. */
const dexIdSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(/^[a-z0-9]+$/, { message: 'dex_id_invalid' });
const idListSchema = z
  .array(dexIdSchema)
  .max(MAX_IDS_PER_LIST)
  .refine(isUnique, { message: 'duplicate_entry' });

/**
 * One category relative to the base (mirrors `CategoryRules` of the ruleset kit). A non-null `allow` is allowlist mode,
 * where `ban` and `unban` must be empty.
 */
const categoryDeltaSchema = z
  .object({
    ban: idListSchema.default([]),
    unban: idListSchema.default([]),
    allow: idListSchema.nullable().default(null),
  })
  .strict()
  .superRefine((category, ctx) => {
    const banned = new Set(category.ban);
    if (category.unban.some((id) => banned.has(id))) {
      ctx.addIssue({ code: 'custom', path: ['unban'], message: 'entry_in_ban_and_unban' });
    }
    if (category.allow !== null) {
      if (category.ban.length > 0 || category.unban.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['allow'], message: 'allowlist_with_bans' });
      }
      if (category.allow.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['allow'], message: 'allowlist_empty' });
      }
    }
  });

const clauseIdsSchema = z
  .array(dexIdSchema)
  .max(MAX_CLAUSE_IDS)
  .refine(isUnique, { message: 'duplicate_entry' });

const boundedJsonObject = (maxBytes: number) =>
  z.custom<{ [key: string]: JsonValue }>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      inspectJson(value, { maxBytes }).ok,
    { message: 'json_object_invalid' },
  );

const emptyCategory = () => ({ ban: [] as string[], unban: [] as string[], allow: null as string[] | null });

/**
 * What the admin asked a ruleset to change relative to its base, as dex ids. `min_shared_type_pct` is the relaxed
 * monotype percentage (integer 0 to 100); `team_constraints` is the kit's own object, validated by the compile step,
 * not here.
 */
export const rulesetDeltaSchema = z
  .object({
    pokemon: categoryDeltaSchema.default(emptyCategory),
    moves: categoryDeltaSchema.default(emptyCategory),
    items: categoryDeltaSchema.default(emptyCategory),
    abilities: categoryDeltaSchema.default(emptyCategory),
    clauses: z
      .object({ add: clauseIdsSchema.default([]), remove: clauseIdsSchema.default([]) })
      .strict()
      .default(() => ({ add: [], remove: [] })),
    min_shared_type_pct: z.int().min(0).max(100).optional(),
    team_constraints: boundedJsonObject(PLAN_LIMITS.teamConstraintsBytes).nullable().optional(),
  })
  .strict();
export type RulesetDocumentDelta = z.output<typeof rulesetDeltaSchema>;

export const RULESET_DELTA_CATEGORIES = ['pokemon', 'moves', 'items', 'abilities'] as const;
export type RulesetDeltaCategory = (typeof RULESET_DELTA_CATEGORIES)[number];

// ─── Slots ───────────────────────────────────────────────────────────

const rulesetName = z.string().trim().min(1).max(MAX_NAME_CHARS);
const presetId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, { message: 'preset_id_invalid' });

/**
 * The ruleset a league, phase or tournament pins. `existing` carries a PUBLISHED ruleset VERSION id (never a
 * definition id); `draft`, `new` and `fork` must be published through their own Go-live card before Build can pin
 * them; `auto_epb` is Evolution Point Buy only (the create route ensures the shared battle ruleset).
 */
export const planRulesetSlotSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), version_id: uuid }).strict(),
  z.object({ mode: z.literal('draft'), definition_id: uuid, draft_rev: z.int().min(0).optional() }).strict(),
  z
    .object({
      mode: z.literal('new'),
      name: rulesetName,
      base_locale: z.enum(LOCALES),
      preset: presetId.optional(),
      tour_overlay: z.boolean().optional(),
      delta: rulesetDeltaSchema.default(() => rulesetDeltaSchema.parse({})),
    })
    .strict(),
  z
    .object({
      mode: z.literal('fork'),
      from_definition_id: uuid,
      name: rulesetName,
      delta: rulesetDeltaSchema.default(() => rulesetDeltaSchema.parse({})),
    })
    .strict(),
  z.object({ mode: z.literal('auto_epb') }).strict(),
]);
export type PlanRulesetSlot = z.output<typeof planRulesetSlotSchema>;

export const planFormatSlotSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }).strict(),
  z.object({ mode: z.literal('existing'), definition_id: uuid, version_no: z.int().min(1).optional() }).strict(),
  z.object({ mode: z.literal('draft'), definition_id: uuid }).strict(),
]);
export type PlanFormatSlot = z.output<typeof planFormatSlotSchema>;

export const planLeagueSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.optional(),
    format_type: seasonFormatTypeSchema,
    start_date: z.iso.date().optional(),
    end_date: z.iso.date().optional(),
    language: contentLanguageSchema,
    clone_from: z
      .object({
        season_id: uuid,
        copy_roster: z.boolean().default(false),
        copy_admins: z.boolean().default(false),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PlanLeague = z.output<typeof planLeagueSchema>;

/** `ruleset: 'plan'` is the ruleset slot once published; `{ id }` is a ruleset VERSION id named directly. */
const rulesetRefSchema = z.union([z.literal('plan'), z.object({ id: uuid }).strict()]);
export type PlanRulesetRef = z.output<typeof rulesetRefSchema>;

const boOverridesSchema = z
  .record(z.string().min(1).max(64), bestOfSchema)
  .refine((record) => Object.keys(record).length <= PLAN_LIMITS.boOverrides, { message: 'too_many_overrides' });

/** `per_group` is required by the route schema; the Plan defaults it to false. */
const advancementRuleSchema = z
  .object({
    type: z.literal('top_n'),
    count: z.int().min(1).max(256),
    per_group: z.boolean().default(false),
  })
  .strict();

export const planPhaseSchema = z
  .object({
    key: keySchema,
    name: nameSchema,
    description: descriptionSchema.optional(),
    bracket_type: bracketTypeSchema,
    best_of: bestOfSchema,
    bo_overrides: boOverridesSchema.optional(),
    is_doubles: z.boolean(),
    bracket_reset_enabled: z.boolean().optional(),
    team_visibility: teamVisibilitySchema.optional(),
    advancement_rule: advancementRuleSchema.optional(),
    ruleset: rulesetRefSchema,
  })
  .strict();
export type PlanPhase = z.output<typeof planPhaseSchema>;

/** Phase names are unique per league, case-insensitively (`assertPhaseNameFree`). */
export const phaseNameKey = (name: string): string => name.trim().toLowerCase();

export const planPhasesSchema = z
  .array(planPhaseSchema)
  .max(PLAN_LIMITS.phases)
  .superRefine((phases, ctx) => {
    const keys = new Set<string>();
    const names = new Set<string>();
    phases.forEach((phase, index) => {
      if (keys.has(phase.key)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'plan_key_duplicate' });
      keys.add(phase.key);
      const nameKey = phaseNameKey(phase.name);
      if (names.has(nameKey)) ctx.addIssue({ code: 'custom', path: [index, 'name'], message: 'PHASE_NAME_TAKEN' });
      names.add(nameKey);
    });
  });

const rosterInput = z.string().trim().min(1).max(FIELD_LIMITS.NAME);

/** A roster entry as the resolver left it: the typed text and where it stands. */
export const planRosterEntrySchema = z.discriminatedUnion('state', [
  z.object({ input: rosterInput, state: z.literal('resolved'), player_id: uuid }).strict(),
  z
    .object({
      input: rosterInput,
      state: z.literal('candidates'),
      player_ids: z.array(uuid).min(2).max(PLAN_LIMITS.candidates),
    })
    .strict(),
  z.object({ input: rosterInput, state: z.literal('unresolved') }).strict(),
  z.object({ input: rosterInput, state: z.literal('skipped') }).strict(),
]);
export type PlanRosterEntry = z.output<typeof planRosterEntrySchema>;

export const planRosterSchema = z
  .object({
    entries: z.array(planRosterEntrySchema).max(PLAN_LIMITS.rosterEntries),
    target_count: z.int().min(1).max(PLAN_LIMITS.rosterEntries).optional(),
  })
  .strict();
export type PlanRoster = z.output<typeof planRosterSchema>;

export const planGroupsSchema = z
  .object({
    mode: z.enum(['serpentine', 'none']),
    count: z.int().min(PLAN_LIMITS.groupsMin).max(PLAN_LIMITS.groupsMax).optional(),
  })
  .strict()
  .superRefine((groups, ctx) => {
    if (groups.mode === 'serpentine' && groups.count === undefined) {
      ctx.addIssue({ code: 'custom', path: ['count'], message: 'groups_count_required' });
    }
    if (groups.mode === 'none' && groups.count !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['count'], message: 'groups_count_not_allowed' });
    }
  });
export type PlanGroups = z.output<typeof planGroupsSchema>;

/**
 * One draft pool. The queue engine (Evolution Point Buy) takes a budget and a seat order and always snakes; the legacy
 * engine takes a pricing type, a turn order and a budget and has no seat order (the options that do not exist for an
 * engine are issues, so the Plan cannot promise them).
 */
export const planDraftEntrySchema = z
  .object({
    group_key: groupKeySchema.optional(),
    engine: z.enum(['legacy', 'queue']),
    draft_type: draftTypeSchema.optional(),
    pick_order: draftPickOrderSchema.optional(),
    budget: z.int().min(0).max(LEGACY_POINTS_MAX).optional(),
    participant_order: z
      .array(uuid)
      .min(DRAFT_CONFIG_LIMITS.participant_order.min)
      .max(DRAFT_CONFIG_LIMITS.participant_order.max)
      .refine(isUnique, { message: 'participant_order_repeats_player' })
      .optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.engine === 'legacy') {
      if (entry.participant_order !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['participant_order'], message: 'draft_option_unsupported' });
      }
      return;
    }
    if (entry.draft_type !== undefined) ctx.addIssue({ code: 'custom', path: ['draft_type'], message: 'draft_option_unsupported' });
    if (entry.pick_order !== undefined && entry.pick_order !== 'snake') {
      ctx.addIssue({ code: 'custom', path: ['pick_order'], message: 'draft_option_unsupported' });
    }
    const { min, max } = DRAFT_CONFIG_LIMITS.budget;
    if (entry.budget !== undefined && (entry.budget < min || entry.budget > max)) {
      ctx.addIssue({ code: 'custom', path: ['budget'], message: 'draft_budget_out_of_range' });
    }
  });
export type PlanDraftEntry = z.output<typeof planDraftEntrySchema>;

export const planDraftSchema = z
  .array(planDraftEntrySchema)
  .max(PLAN_LIMITS.draftPools)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const key = entry.group_key ?? '';
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index, 'group_key'], message: 'draft_pool_duplicate' });
      seen.add(key);
    });
  });

export const planTournamentSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.optional(),
    bracket_type: bracketTypeSchema,
    best_of: bestOfSchema,
    bo_overrides: boOverridesSchema.optional(),
    is_doubles: z.boolean(),
    bracket_reset_enabled: z.boolean().optional(),
    team_visibility: teamVisibilitySchema,
    ruleset: rulesetRefSchema,
  })
  .strict();
export type PlanTournament = z.output<typeof planTournamentSchema>;

export const PLAN_SLOT_NAMES = ['ruleset', 'format', 'league', 'phases', 'roster', 'groups', 'draft', 'tournament'] as const;
export type PlanSlotName = (typeof PLAN_SLOT_NAMES)[number];

/** The value schema of each slot (what `plan_set` validates before it replaces the slot). */
export const PLAN_SLOT_SCHEMAS = {
  ruleset: planRulesetSlotSchema,
  format: planFormatSlotSchema,
  league: planLeagueSchema,
  phases: planPhasesSchema,
  roster: planRosterSchema,
  groups: planGroupsSchema,
  draft: planDraftSchema,
  tournament: planTournamentSchema,
} as const satisfies Record<PlanSlotName, z.ZodType>;

const planSlotsSchema = z
  .object({
    ruleset: planRulesetSlotSchema.optional(),
    format: planFormatSlotSchema.optional(),
    league: planLeagueSchema.optional(),
    phases: planPhasesSchema.optional(),
    roster: planRosterSchema.optional(),
    groups: planGroupsSchema.optional(),
    draft: planDraftSchema.optional(),
    tournament: planTournamentSchema.optional(),
  })
  .strict();
export type PlanSlots = z.output<typeof planSlotsSchema>;

// ─── Document ────────────────────────────────────────────────────────

export const PLAN_INTENTS = ['league', 'tournament', 'ruleset', 'format', 'mixed'] as const;
export type PlanIntent = (typeof PLAN_INTENTS)[number];

export const ASSUMPTION_SOURCES = ['admin', 'default', 'inferred'] as const;

const assumptionValue = z.custom<JsonValue>(
  (value) => value !== undefined && inspectJson(value, { maxBytes: PLAN_LIMITS.assumptionValueBytes }).ok,
  { message: 'assumption_value_not_json' },
);

/**
 * A default or inference the assistant made, shown as an "assumed" chip with its source. Model prose persisted
 * un-keyed: labelled "assistant-written" on cards, never used in outward text.
 */
export const planAssumptionSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_.:-]{0,63}$/, { message: 'assumption_key_invalid' }),
    value: assumptionValue,
    source: z.enum(ASSUMPTION_SOURCES),
    confirmed: z.boolean(),
  })
  .strict();
export type PlanAssumption = z.output<typeof planAssumptionSchema>;

/**
 * The assumption that carries "N circles of the round robin" for a phase. The Plan has no `legs` field (the engine
 * plays one circle), so an admin's request for a double round robin is recorded here, where `planReadiness` turns it
 * into the typed engine-gap blocker instead of letting the Plan silently claim it.
 */
export const roundRobinLegsKey = (phaseKey: string): string => `legs.${phaseKey}`;

/** Where Build stored the entity a slot became: keys are `league`, `roster`, `groups`, `tournament`, `phase.<key>`, `draft.<A..Z|all>`. */
export const PLAN_REF_KEY_PATTERN = /^(?:league|roster|groups|tournament|phase\.[a-z][a-z0-9_]{0,31}|draft\.(?:[A-Z]|all))$/;
export const phaseRefKey = (phaseKey: string): string => `phase.${phaseKey}`;
export const draftRefKey = (groupKey: string | undefined): string => `draft.${groupKey ?? 'all'}`;

const planRefsSchema = z.record(z.string().regex(PLAN_REF_KEY_PATTERN, { message: 'plan_ref_key_invalid' }), z
  .object({ entity_type: z.string().regex(/^[a-z][a-z_]{0,31}$/), entity_id: uuid })
  .strict());
export type PlanRefs = z.output<typeof planRefsSchema>;

export const planDocumentSchema = z
  .object({
    v: z.literal(PLAN_VERSION),
    title: nameSchema,
    intent: z.enum(PLAN_INTENTS),
    contentLocale: z.enum(LOCALES),
    assumptions: z
      .array(planAssumptionSchema)
      .max(PLAN_LIMITS.assumptions)
      .superRefine((assumptions, ctx) => {
        const seen = new Set<string>();
        assumptions.forEach((assumption, index) => {
          if (seen.has(assumption.key)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'assumption_key_duplicate' });
          seen.add(assumption.key);
        });
      }),
    slots: planSlotsSchema,
    refs: planRefsSchema,
  })
  .strict();
export type PlanDocument = z.output<typeof planDocumentSchema>;
export type PlanDocumentInput = z.input<typeof planDocumentSchema>;

// ─── Parsing and issues ──────────────────────────────────────────────

/** A schema problem as data: where, and a machine code (never prose). */
export interface PlanIssue {
  /** RFC 6901 pointer into the Plan document. */
  path: string;
  code: string;
}

const MACHINE_CODE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * The code of a zod issue: our own refinements and `message` options carry a machine code in `message`; any other
 * issue keeps zod's issue code (`invalid_type`, `too_small`, `unrecognized_keys`, ...). Zod's English messages are
 * never passed on.
 */
export function issueCode(issue: z.core.$ZodIssue): string {
  return MACHINE_CODE.test(issue.message) ? issue.message : issue.code;
}

export function toPlanIssues(error: z.ZodError, pathPrefix: readonly (string | number)[] = []): PlanIssue[] {
  const seen = new Set<string>();
  const out: PlanIssue[] = [];
  for (const issue of error.issues) {
    const segments = [...pathPrefix, ...issue.path.map((segment) => String(segment))];
    // An unrecognized key names the keys; report one issue per key so the model sees which one to drop.
    const paths =
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => [...segments, key])
        : [segments];
    for (const path of paths) {
      const pointer = `/${path.map((s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`.replace(/^\/$/, '');
      const code = issueCode(issue);
      const id = `${pointer}|${code}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ path: pointer, code });
    }
  }
  return out;
}

// ─── Hints for the model ─────────────────────────────────────────────

const keysOf = (schema: { shape: Record<string, unknown> }): string => Object.keys(schema.shape).join(', ');

/**
 * What an `unrecognized_keys` issue may name instead, by the (index-free) path of the object that got the stray key.
 * Static text built from the schemas' own key lists, so it cannot drift from them; a value the admin or the model sent
 * is never in it. Objects whose keys depend on a `mode` / `state` list every branch.
 */
const ALLOWED_KEYS: Readonly<Record<string, string>> = {
  '': keysOf(planDocumentSchema),
  '/slots': keysOf(planSlotsSchema),
  '/slots/ruleset': 'by mode: existing {version_id}; draft {definition_id, draft_rev}; new {name, base_locale, preset, tour_overlay, delta}; fork {from_definition_id, name, delta}; auto_epb {}',
  '/slots/format': 'by mode: none {}; existing {definition_id, version_no}; draft {definition_id}',
  '/slots/league': keysOf(planLeagueSchema),
  '/slots/league/clone_from': 'season_id, copy_roster, copy_admins',
  '/slots/phases/*': keysOf(planPhaseSchema),
  '/slots/phases/*/advancement_rule': 'type, count, per_group',
  '/slots/roster': keysOf(planRosterSchema),
  '/slots/roster/entries/*': 'by state: resolved {input, player_id}; candidates {input, player_ids}; unresolved {input}; skipped {input}',
  '/slots/groups': keysOf(planGroupsSchema),
  '/slots/draft/*': keysOf(planDraftEntrySchema),
  '/slots/tournament': keysOf(planTournamentSchema),
  '/assumptions/*': keysOf(planAssumptionSchema),
};

/** What an `invalid_union` issue wants instead, by the (index-free) path the issue points at. */
const UNION_EXPECTED: Readonly<Record<string, string>> = {
  '/slots/ruleset/mode': 'mode is one of existing, draft, new, fork, auto_epb',
  '/slots/format/mode': 'mode is one of none, existing, draft',
  '/slots/roster/entries/*/state': 'state is one of resolved, candidates, unresolved, skipped',
  '/slots/phases/*/ruleset': 'ruleset is "plan" or {"id": <published ruleset version id>}',
  '/slots/tournament/ruleset': 'ruleset is "plan" or {"id": <published ruleset version id>}',
};

const indexFree = (pointer: string): string => pointer.split('/').map((segment) => (/^\d+$/.test(segment) ? '*' : segment)).join('/');

/** For the issues of one refusal, the distinct static hints that make an `invalid_union` or `unrecognized_keys` issue actionable. */
export function planIssueHints(issues: readonly PlanIssue[]): Map<PlanIssue, string> {
  const out = new Map<PlanIssue, string>();
  const used = new Set<string>();
  for (const issue of issues) {
    let hint: string | undefined;
    if (issue.code === 'invalid_union') {
      const expected = UNION_EXPECTED[indexFree(issue.path)];
      if (expected) hint = `expected ${expected}`;
    } else if (issue.code === 'unrecognized_keys') {
      const parent = indexFree(issue.path.slice(0, Math.max(issue.path.lastIndexOf('/'), 0)));
      const allowed = ALLOWED_KEYS[parent];
      if (allowed) hint = `${parent || '/'} takes only ${allowed}`;
    }
    if (hint === undefined || used.has(hint)) continue;
    used.add(hint);
    out.set(issue, hint);
  }
  return out;
}

/** Drop `undefined` members so the document is plain JSON (hashable, storable). */
export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export type ParsePlanResult = { ok: true; plan: PlanDocument } | { ok: false; issues: PlanIssue[] };

/** Parse and normalise a Plan (defaults filled, plain JSON). The normalised form is what is stored and hashed. */
export function parsePlanDocument(input: unknown): ParsePlanResult {
  const result = planDocumentSchema.safeParse(input);
  if (!result.success) return { ok: false, issues: toPlanIssues(result.error) };
  return { ok: true, plan: jsonClone(result.data) };
}

export function emptyPlan(init: { title: string; intent: PlanIntent; contentLocale: PlanDocument['contentLocale'] }): PlanDocument {
  return { v: PLAN_VERSION, title: init.title, intent: init.intent, contentLocale: init.contentLocale, assumptions: [], slots: {}, refs: {} };
}
