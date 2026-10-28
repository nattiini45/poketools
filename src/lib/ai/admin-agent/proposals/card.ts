/**
 * The card data model (plan 4.5 "The card", 5.4; spec §18.6): everything a proposal card shows, as STRUCTURED DATA.
 *
 * A card is built by code at staging, stored frozen in `admin_agent_proposals.preview` and rendered at view time by the UI
 * with `useT('admin-assistant-cards')` in the viewer's locale. It holds machine kinds, entity names (sanitised plain text
 * with a hidden-character count), counts and flags, and never a translated sentence, so a language switch re-renders every
 * card and nothing the model wrote reaches it (the model's own words are a separate, labelled bubble).
 *
 * `CARD_TEXT_KEYS` says which existing catalog key renders each line kind, `null` where the catalog has no text yet (the
 * UI lane adds it with the card). A test keeps the mapped keys real.
 */
import { z } from 'zod';
import type { PlanDocument } from '../plans/schema';
import type { PlanBlocker } from '../plans/readiness';
import { UNDO_REASONS, type UndoReason } from '../plans/undo';
import type { BuildSummary, PlanEffect, PlanStep } from '../plans/steps';
import { sanitizeCardText, type CardText } from './text';
import type { EpbBattleRulesetHead, StagingAdmin } from './types';

export const CARD_LINE_KINDS = [
  'visible_publicly',
  'creator_becomes_admin',
  'pins_ruleset',
  'pins_ruleset_auto',
  'ensures_battle_ruleset',
  'publishes_ruleset_readable',
  'enrolls_roster',
  'prefilled_from_standings',
  'clones_from',
  'will_not_start',
  'name_in_use',
  'existing_entity',
  'locks_after_start',
  'immutable_version',
  'selectable_by_admins',
  'pin_impact',
  'pin_started_targets',
  'ruleset_changes_live_rules',
  'draft_unsaved_changes',
  'archived_stays_reachable',
] as const;
export type CardLineKind = (typeof CARD_LINE_KINDS)[number];

/** Catalog key (`admin-assistant-cards`) that renders a line kind, or `null` while the catalog has no text for it. */
export const CARD_TEXT_KEYS: Readonly<Record<CardLineKind, string | null>> = {
  visible_publicly: 'build.visiblePublicly',
  creator_becomes_admin: null,
  pins_ruleset: 'build.pinsRuleset',
  pins_ruleset_auto: 'build.pinsRuleset',
  ensures_battle_ruleset: null,
  publishes_ruleset_readable: 'build.publishesRuleset',
  enrolls_roster: null,
  prefilled_from_standings: null,
  clones_from: null,
  will_not_start: 'build.willNotDo',
  name_in_use: null,
  existing_entity: null,
  locks_after_start: 'build.lockedAfter',
  immutable_version: null,
  selectable_by_admins: null,
  pin_impact: null,
  pin_started_targets: null,
  ruleset_changes_live_rules: null,
  draft_unsaved_changes: null,
  archived_stays_reachable: null,
};

export const CARD_ENTITIES = ['league', 'roster', 'phase', 'groups', 'draft_pool', 'tournament', 'ruleset'] as const;
export type CardEntity = (typeof CARD_ENTITIES)[number];

export const CARD_ACTIONS = ['create', 'add', 'set', 'publish', 'move_pin', 'start', 'generate_bracket', 'archive', 'remove', 'restore_draft', 'delete_draft'] as const;
export type CardAction = (typeof CARD_ACTIONS)[number];

const cardText = z.strictObject({ text: z.string().max(400), hidden: z.number().int().min(0) });
const cardParam = z.union([z.string().max(400), z.number(), z.boolean(), cardText]);
export type CardParam = z.infer<typeof cardParam>;

const cardLine = z.strictObject({
  kind: z.enum(CARD_LINE_KINDS),
  params: z.record(z.string().max(40), cardParam).optional(),
});
export type CardLine = z.infer<typeof cardLine>;

const cardTarget = z.strictObject({
  entity: z.enum(CARD_ENTITIES),
  /** The row's id when it exists already; `null` for something the proposal creates. */
  id: z.string().nullable(),
  name: cardText.nullable(),
  count: z.number().int().min(0).optional(),
  version_no: z.number().int().min(0).optional(),
});
export type CardTarget = z.infer<typeof cardTarget>;

const cardStep = z.strictObject({
  key: z.string().max(64),
  op: z.string().max(64),
  action: z.enum(CARD_ACTIONS),
  target: cardTarget,
  /** Further rows the step acts on (the leagues and phases of a pin move). */
  items: z.array(cardTarget).max(60),
  lines: z.array(cardLine),
});
export type CardStep = z.infer<typeof cardStep>;

const cardAck = z.strictObject({
  id: z.string().max(64),
  kind: z.enum(['checkbox', 'typed_name']),
  /** Checkbox: the outward-effect group it acknowledges. */
  effect: z.string().max(64).optional(),
  /** Typed name: what is typed, and the NFC text it must equal (hidden characters removed, so it can always be typed). */
  of: z.enum(['league', 'format']).optional(),
  expected: cardText.optional(),
});
export type CardAck = z.infer<typeof cardAck>;

const cardEffect = z.strictObject({
  key: z.string().max(64),
  channels: z.discriminatedUnion('kind', [
    /** The effect posts nothing (an immutable version, a lock). */
    z.strictObject({ kind: z.literal('none') }),
    /** It posts to Discord and social and the app cannot say which channels (non-site admins, or before PR5). */
    z.strictObject({ kind: z.literal('unknown') }),
    z.strictObject({ kind: z.literal('counted'), discord: z.number().int().min(0), social: z.number().int().min(0), names: z.array(cardText).max(40) }),
  ]),
});
export type CardEffect = z.infer<typeof cardEffect>;

export const CARD_VERSION = 1 as const;

/** One ledger entry an undo does not run, with the catalogued reason (the card words it). */
const undoNote = z.strictObject({
  op: z.string().max(64),
  entity: z.enum(CARD_ENTITIES).nullable(),
  id: z.string().nullable(),
  name: cardText.nullable(),
  reason: z.enum(UNDO_REASONS as unknown as [UndoReason, ...UndoReason[]]),
});
export type UndoNote = z.infer<typeof undoNote>;

export const proposalCardSchema = z.strictObject({
  v: z.literal(CARD_VERSION),
  kind: z.enum(['build', 'go_live', 'undo']),
  class: z.enum(['B', 'G']),
  tool: z.string().max(64),
  /** The first 8 hex of the proposal hash. */
  planCode: z.string().regex(/^[0-9a-f]{8}$/),
  /** Build only: the Plan this Build is for (the title is assistant-written prose and is labelled so). */
  plan: z
    .strictObject({
      id: z.string(),
      revision: z.number().int().min(1),
      title: cardText,
      intent: z.string().max(20),
      contentLocale: z.enum(['en', 'de']),
    })
    .nullable(),
  summary: z.strictObject({ steps: z.number().int().min(0), creates: z.number().int().min(0) }),
  steps: z.array(cardStep).min(1).max(40),
  lines: z.array(cardLine).max(30),
  warnings: z.array(cardLine).max(30),
  assumptions: z
    .array(
      z.strictObject({
        key: z.string().max(64),
        source: z.enum(['admin', 'default', 'inferred']),
        confirmed: z.boolean(),
        value: z.union([cardText, z.number(), z.boolean()]).nullable(),
      }),
    )
    .max(40),
  acks: z.array(cardAck).max(12),
  outwardEffects: z.array(cardEffect).max(12),
  reversibility: z.discriminatedUnion('kind', [
    /** Compensating changes exist (archive, remove the roster rows it added). */
    z.strictObject({ kind: z.literal('undoable') }),
    z.strictObject({
      kind: z.literal('irreversible'),
      reason: z.enum(['immutable_version', 'posted_outward', 'changes_live_rules', 'started', 'compensating']),
    }),
  ]),
  /** G only: "existing league, not created in this chat" (plan 3.5 rule 5). */
  existingEntity: z.boolean(),
  /** Undo only: what the undo leaves alone, leaves behind or cannot do (spec §18.8), each with its reason. */
  undo: z
    .strictObject({
      leftAlone: z.array(undoNote).max(60),
      residue: z.array(undoNote).max(60),
      notUndoable: z.array(undoNote).max(60),
      /** More could be undone than fits one proposal; ask again for the rest. */
      truncated: z.boolean(),
    })
    .optional(),
});
export type ProposalCard = z.infer<typeof proposalCardSchema>;

// ─── Building blocks ─────────────────────────────────────────────────────────

export const text = (raw: string, max?: number): CardText => sanitizeCardText(raw, max);

export function line(kind: CardLineKind, params?: Record<string, CardParam>): CardLine {
  return params === undefined ? { kind } : { kind, params };
}

/** A ruleset VERSION a step pins, as the live guard described it. */
export interface PinnedRulesetInfo {
  versionId: string;
  versionNo: number;
  slug: string;
  visibility: 'private' | 'league' | 'gallery';
}

// ─── The Build card ──────────────────────────────────────────────────────────

export interface BuildCardInput {
  plan: PlanDocument;
  planId: string;
  planRevision: number;
  steps: readonly PlanStep[];
  summary: BuildSummary;
  /** By lower-case version id: every ruleset version a step pins explicitly. */
  rulesets: ReadonlyMap<string, PinnedRulesetInfo>;
  epbHead: EpbBattleRulesetHead | null;
  warnings: readonly PlanBlocker[];
  admin: StagingAdmin;
}

type Body = Record<string, unknown>;

const bodyOf = (step: PlanStep): Body => (typeof step.args.body === 'object' && step.args.body !== null && !Array.isArray(step.args.body) ? (step.args.body as Body) : {});
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function stepTarget(step: PlanStep): { action: CardAction; target: CardTarget } {
  const body = bodyOf(step);
  switch (step.op) {
    case 'league_create':
      return { action: 'create', target: { entity: 'league', id: null, name: text(str(body.name) ?? '') } };
    case 'roster_add': {
      const ids = Array.isArray(body.player_ids) ? body.player_ids.length : 0;
      const league = step.args.path.id;
      return { action: 'add', target: { entity: 'roster', id: typeof league === 'string' ? league : null, name: null, count: ids } };
    }
    case 'phase_create':
      return { action: 'create', target: { entity: 'phase', id: null, name: text(str(body.name) ?? '') } };
    case 'groups_set':
      return { action: 'set', target: { entity: 'groups', id: null, name: null, count: typeof body.group_count === 'number' ? body.group_count : 0 } };
    case 'draft_pool_create':
      return { action: 'create', target: { entity: 'draft_pool', id: null, name: null } };
    case 'tournament_create':
      return { action: 'create', target: { entity: 'tournament', id: null, name: text(str(body.name) ?? '') } };
  }
}

function pinLine(step: PlanStep, effect: Extract<PlanEffect, { kind: 'pins_ruleset' }>, input: BuildCardInput): CardLine | null {
  const versionId = str(bodyOf(step).ruleset_id) ?? effect.versionId ?? null;
  if (versionId !== null) {
    const info = input.rulesets.get(versionId.toLowerCase());
    if (info === undefined) return null;
    return line('pins_ruleset', { ruleset: text(info.slug), version: info.versionNo });
  }
  // The league route ensures the shared Point Buy Battle ruleset; later steps read the version the league pinned.
  const head = input.epbHead;
  return head === null ? line('pins_ruleset_auto') : line('pins_ruleset_auto', { ruleset: text(head.slug), version: head.versionNo });
}

function effectLines(step: PlanStep, input: BuildCardInput): CardLine[] {
  const lines: CardLine[] = [];
  for (const effect of step.effects) {
    switch (effect.kind) {
      case 'pins_ruleset': {
        const pin = pinLine(step, effect, input);
        if (pin !== null) lines.push(pin);
        break;
      }
      case 'ensures_battle_ruleset':
        lines.push(line('ensures_battle_ruleset'));
        break;
      case 'enrolls_roster':
        lines.push(line('enrolls_roster'));
        break;
      case 'prefilled_from_standings': {
        const previous = input.plan.slots.phases?.find((phase) => phase.key === effect.previousPhaseKey);
        lines.push(
          line('prefilled_from_standings', {
            phase: text(previous?.name ?? effect.previousPhaseKey),
            ...(effect.count === undefined ? {} : { count: effect.count }),
            ...(effect.perGroup === undefined ? {} : { per_group: effect.perGroup }),
          }),
        );
        break;
      }
      case 'clones_from':
        lines.push(line('clones_from', { copy_roster: effect.copyRoster }));
        break;
      case 'visible_publicly':
      case 'creator_becomes_admin':
        break; // card level, once
    }
  }
  return lines;
}

/** The Build card for the steps `deriveSteps` made (4.4, 4.10). The proposal hash is not known yet: `planCode` is added by the caller. */
export function buildBuildCard(input: BuildCardInput): Omit<ProposalCard, 'planCode'> {
  const { plan, steps } = input;
  const effects = steps.flatMap((step) => step.effects);

  const lines: CardLine[] = [];
  if (effects.some((effect) => effect.kind === 'visible_publicly')) lines.push(line('visible_publicly'));
  if (!input.admin.isSiteAdmin && effects.some((effect) => effect.kind === 'creator_becomes_admin')) lines.push(line('creator_becomes_admin'));
  // Pinning a PRIVATE published version makes it publicly readable (plan 3.5 rule 7).
  const seen = new Set<string>();
  for (const step of steps) {
    const versionId = str(bodyOf(step).ruleset_id)?.toLowerCase();
    const info = versionId === undefined ? undefined : input.rulesets.get(versionId);
    if (info === undefined || info.visibility !== 'private' || seen.has(info.versionId)) continue;
    seen.add(info.versionId);
    lines.push(line('publishes_ruleset_readable', { ruleset: text(info.slug), version: info.versionNo }));
  }
  lines.push(line('will_not_start'));

  const warnings = input.warnings.filter((warning) => warning.code === 'league_name_in_use').map(() => line('name_in_use'));

  return {
    v: CARD_VERSION,
    kind: 'build',
    class: 'B',
    tool: 'propose_build',
    plan: {
      id: input.planId,
      revision: input.planRevision,
      title: text(plan.title),
      intent: plan.intent,
      contentLocale: plan.contentLocale,
    },
    summary: { steps: input.summary.steps, creates: input.summary.creating },
    steps: steps.map((step) => {
      const { action, target } = stepTarget(step);
      return { key: step.key, op: step.op, action, target, items: [], lines: effectLines(step, input) };
    }),
    lines,
    warnings,
    assumptions: plan.assumptions.map((assumption) => ({
      key: assumption.key,
      source: assumption.source,
      confirmed: assumption.confirmed,
      value:
        typeof assumption.value === 'string'
          ? text(assumption.value)
          : typeof assumption.value === 'number' || typeof assumption.value === 'boolean'
            ? assumption.value
            : null,
    })),
    acks: input.summary.acks.map((id) => ({ id, kind: 'checkbox' as const })),
    outwardEffects: [],
    reversibility: { kind: 'undoable' },
    existingEntity: false,
  };
}
