/**
 * Preparing the Go-live (G) proposals of phase 1 (plan 3.6.7, 4.5, 3.3 preflight): `propose_publish_ruleset`,
 * `propose_move_pin`, `propose_start_phase`, `propose_generate_bracket`. Each is ONE exact route call with its own card.
 *
 * The model's arguments pick the target; everything else (the request body, the acknowledgements, the outward effects, the
 * fingerprints, every word on the card) is derived here from live state. The checks are the routes' own shared functions
 * and typed codes, so a card is refused at staging for what the route would refuse at approve; the route stays the authority.
 *
 * Not stageable yet (they answer `phase_disabled`): the later-phase G tools, and `propose_undo`, whose steps come from the
 * ledger (plan 4.7) and are built with the undo lane. `GOLIVE_NOT_STAGEABLE` lists them, and a test keeps that list and the
 * registry in step so a new G tool is a conscious decision.
 */
import { ltext } from '@/lib/studio-core/ltext';
import type { JsonValue } from '@/lib/studio-core/json';
import type { StagedTool } from '../registry/define';
import { line, text, type CardAck, type CardEffect, type CardEntity, type CardLine, type CardStep, type CardTarget, type ProposalCard, CARD_VERSION } from './card';
import type { PreconditionSpec } from './fingerprints';
import { StageRefusal, type PrepareContext, type Prepared } from './prepare';
import type { StepDraft } from './steps';
import type { PhaseStartFact, PinTargetFact } from './types';

export const GOLIVE_STAGEABLE = ['propose_publish_ruleset', 'propose_move_pin', 'propose_start_phase', 'propose_generate_bracket'] as const;
export type GoLiveToolName = (typeof GOLIVE_STAGEABLE)[number];

/** G tools the registry lists that this module does not stage. Anything that is neither here nor stageable fails the registry test. */
export const GOLIVE_NOT_STAGEABLE: readonly string[] = [
  'propose_undo',
  'propose_generate_round',
  'propose_league_status',
  'propose_advance_phase',
  'propose_start_round',
  'propose_complete_round',
  'propose_complete_tournament',
  'propose_league_trash',
  'propose_publish_format',
  'propose_set_format_visibility',
  'propose_attach_format',
  'propose_detach_format',
  'propose_draft_start',
  'propose_draft_activate_legacy_pool',
  'propose_redraft_create',
  'propose_redraft_publish',
];

export const isStageableGoLive = (name: string): name is GoLiveToolName => (GOLIVE_STAGEABLE as readonly string[]).includes(name);

/** Outward-effect groups that post to Discord and social (the others only change data). */
const POSTING_EFFECTS: ReadonlySet<string> = new Set(['round_generated', 'tournament_started']);

const asJson = (value: unknown): JsonValue => value as JsonValue;

interface GoLiveCardParts {
  step: Omit<CardStep, 'key' | 'op'>;
  reversal: Extract<ProposalCard['reversibility'], { kind: 'irreversible' }>['reason'];
  existingEntity: boolean;
  ack?: CardAck;
  /** Effect groups to acknowledge; a subset of the tool's declared outward effects. */
  effectKeys: string[];
  ids: { tournamentId: string | null; seasonId: string | null };
}

async function effectsOf(ctx: PrepareContext, keys: readonly string[], ids: GoLiveCardParts['ids']): Promise<CardEffect[]> {
  const siteAdmin = ctx.input.admin.isSiteAdmin;
  const effects: CardEffect[] = [];
  for (const key of keys) {
    if (!POSTING_EFFECTS.has(key)) {
      effects.push({ key, channels: { kind: 'none' } });
      continue;
    }
    // Names of matching channels are for site admins; others are told the app cannot say which (plan 4.5 "The card").
    const matched = siteAdmin && ctx.deps.source.recipients !== undefined ? await ctx.deps.source.recipients({ eventType: key, tournamentId: ids.tournamentId, seasonId: ids.seasonId }) : null;
    effects.push({
      key,
      channels:
        matched === null
          ? { kind: 'unknown' }
          : { kind: 'counted', discord: matched.discord.count, social: matched.social.count, names: [...matched.discord.names, ...matched.social.names].slice(0, 40).map((name) => text(name, 60)) },
    });
  }
  return effects;
}

function declaredEffects(tool: StagedTool, keep: (key: string) => boolean = () => true): string[] {
  return (tool.outwardEffects ?? []).map((effect) => effect.key).filter(keep);
}

/** Wraps the per-tool parts into the common `Prepared`. */
async function prepared(
  ctx: PrepareContext,
  draft: StepDraft,
  specs: PreconditionSpec[],
  parts: GoLiveCardParts,
  supersedeKey: string,
): Promise<Prepared> {
  const outward = await effectsOf(ctx, parts.effectKeys, parts.ids);
  const acks: CardAck[] = [...parts.effectKeys.map((key): CardAck => ({ id: key, kind: 'checkbox', effect: key })), ...(parts.ack ? [parts.ack] : [])];
  const tool = ctx.tool.name;
  return {
    kind: 'action',
    class: 'G',
    planId: null,
    planRevision: null,
    steps: [{ step: { ...draft, outward_effects: parts.effectKeys }, specs, touches: [] }],
    scopeOf: () => null,
    acks: acks.map((ack) => ack.id),
    supersedeKey,
    ttl: 'golive',
    card: (planCode) => ({
      v: CARD_VERSION,
      kind: 'go_live',
      class: 'G',
      tool,
      planCode,
      plan: null,
      summary: { steps: 1, creates: 0 },
      steps: [{ key: draft.key, op: draft.op, ...parts.step }],
      lines: [],
      warnings: [],
      assumptions: [],
      acks,
      outwardEffects: outward,
      reversibility: { kind: 'irreversible', reason: parts.reversal },
      existingEntity: parts.existingEntity,
    }),
  };
}

const baseStep = (key: string, op: string, route: { method: StepDraft['method']; routeTemplate: string }, verify: string): Omit<StepDraft, 'path_params' | 'query' | 'body_template' | 'targets' | 'outward_effects' | 'preconditions'> => ({
  key,
  op,
  class: 'G',
  method: route.method,
  route_template: route.routeTemplate,
  min_role: 'any',
  blocked_by: [],
  entity_type: 'ruleset',
  creates: false,
  ref_key: null,
  verify,
  reversal: 'none',
});

// ─── propose_publish_ruleset ─────────────────────────────────────────────────

async function preparePublishRuleset(ctx: PrepareContext, args: { ruleset_id: string; draft_rev: number; changelog_text?: string }): Promise<Prepared> {
  const { deps, input } = ctx;
  const guarded = await deps.guard({ kind: 'rulesetOwner', id: args.ruleset_id });
  const definition = guarded.ruleset.definition;

  const draft = await deps.source.rulesetDraft(definition.id);
  if (draft === null) throw new StageRefusal('ruleset_not_found');
  // The route CASes the revision too; refusing here means the card is never for a draft that has moved on.
  if (draft.draftRev !== args.draft_rev) throw new StageRefusal('ruleset_stale_revision', { revision: draft.draftRev });
  if (draft.errorDiagnostics > 0) throw new StageRefusal('ruleset_document_invalid', { count: draft.errorDiagnostics });

  const locale = input.conversation.ui_locale === 'de' ? 'de' : 'en';
  const body: Record<string, JsonValue> = { draft_rev: args.draft_rev };
  if (args.changelog_text !== undefined) body.changelog = asJson(ltext(locale, locale === 'en' ? args.changelog_text : undefined, locale === 'de' ? args.changelog_text : undefined));

  const shared = draft.visibility !== 'private';
  const effectKeys = declaredEffects(ctx.tool, (key) => key !== 'shared_selectable' || shared);
  const lines = [line('immutable_version'), ...(shared ? [line('selectable_by_admins', { visibility: draft.visibility })] : [])];
  const target: CardTarget = { entity: 'ruleset', id: definition.id, name: text(draft.slug) };

  const draftStep: StepDraft = {
    ...baseStep('publish_ruleset', 'publish_ruleset', { method: 'POST', routeTemplate: '/api/ruleset-definitions/[id]/publish' }, 'ruleset_version_exists'),
    path_params: { id: definition.id },
    query: {},
    body_template: body,
    targets: [{ kind: 'ruleset', id: definition.id }],
    outward_effects: [],
    preconditions: [],
  };
  return prepared(
    ctx,
    draftStep,
    [{ read: 'ruleset_draft', target: { kind: 'id', id: definition.id } }],
    {
      step: { action: 'publish', target, items: [], lines },
      reversal: 'immutable_version',
      existingEntity: !(await ctx.createdInChat([definition.id])),
      effectKeys,
      ids: { tournamentId: null, seasonId: null },
    },
    `propose_publish_ruleset:${definition.id}`,
  );
}

// ─── propose_move_pin ────────────────────────────────────────────────────────

interface PinTargetArg {
  kind: 'season' | 'tournament';
  id: string;
}

async function prepareMovePin(ctx: PrepareContext, args: { ruleset_id: string; to_version_no: number; targets: PinTargetArg[] }): Promise<Prepared> {
  const { deps } = ctx;
  const guarded = await deps.guard({ kind: 'rulesetViewer', id: args.ruleset_id });
  const definition = guarded.ruleset.definition;
  // The caller must administer every target (the route re-checks each one, live).
  for (const target of args.targets) await deps.guard({ kind: target.kind, id: target.id });

  if (!(await deps.source.rulesetVersionExists(definition.id, args.to_version_no))) throw new StageRefusal('ruleset_not_found');

  const facts = await deps.source.pinTargets(args.targets);
  const byKey = new Map(facts.map((fact) => [`${fact.kind}:${fact.id.toLowerCase()}`, fact]));
  const ordered: PinTargetFact[] = [];
  for (const target of args.targets) {
    const fact = byKey.get(`${target.kind}:${target.id.toLowerCase()}`);
    if (fact === undefined) throw new StageRefusal('forbidden');
    // A target that pins another ruleset is not this ruleset's to move (the route answers ruleset_pin_mismatch).
    if (fact.pinnedDefinitionId !== definition.id) throw new StageRefusal('ruleset_pin_mismatch');
    if (fact.completed) throw new StageRefusal('ruleset_pin_locked');
    ordered.push(fact);
  }
  const impact = await deps.source.pinImpact({ definitionId: definition.id, toVersionNo: args.to_version_no, targets: args.targets });

  // The executor passes the started targets' ids as `confirm_started`; it is part of the stored body and the hash.
  const started = ordered.filter((fact) => fact.started).map((fact) => fact.id);
  const body: Record<string, JsonValue> = { to_version_no: args.to_version_no, targets: args.targets.map((t) => ({ kind: t.kind, id: t.id })) };
  if (started.length > 0) body.confirm_started = started;

  const items: CardTarget[] = ordered.map((fact) => ({ entity: fact.kind === 'season' ? 'league' : 'phase', id: fact.id, name: text(fact.name) }));
  const lines: CardLine[] = [
    line('ruleset_changes_live_rules'),
    line('pin_impact', { would_break: impact.wouldBreak, checked: impact.checked, truncated: impact.truncated }),
    ...(started.length > 0 ? [line('pin_started_targets', { count: started.length })] : []),
  ];

  const draftStep: StepDraft = {
    ...baseStep('move_pin', 'move_pin', { method: 'POST', routeTemplate: '/api/ruleset-definitions/[id]/pins' }, 'pin_moved'),
    path_params: { id: definition.id },
    query: {},
    body_template: body,
    targets: [{ kind: 'ruleset', id: definition.id }, ...ordered.map((fact) => ({ kind: fact.kind, id: fact.id }))],
    outward_effects: [],
    preconditions: [],
  };
  return prepared(
    ctx,
    draftStep,
    [{ read: 'pin_state', target: { kind: 'params', params: asJson({ definition_id: definition.id, to_version_no: args.to_version_no, targets: [...args.targets].map((t) => ({ kind: t.kind, id: t.id })).sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)) }) } }],
    {
      step: { action: 'move_pin', target: { entity: 'ruleset', id: definition.id, name: text(definition.slug), count: ordered.length, version_no: args.to_version_no }, items, lines },
      reversal: 'changes_live_rules',
      existingEntity: !(await ctx.createdInChat(ordered.map((fact) => fact.id))),
      effectKeys: declaredEffects(ctx.tool),
      ids: { tournamentId: null, seasonId: null },
    },
    `propose_move_pin:${definition.id}`,
  );
}

// ─── propose_start_phase / propose_generate_bracket ──────────────────────────

function phaseFindings(fact: PhaseStartFact, op: 'start_phase' | 'generate_bracket'): void {
  // The same causes the routes name (3.3): rounds already written, a custom league without an attached format.
  if (fact.roundCount > 0) throw new StageRefusal('rounds_round_already_written', { round: op === 'start_phase' ? 'Round 1' : 'The bracket' });
  if (fact.seasonFormatType === 'custom' && !fact.formatAttached) throw new StageRefusal('format_not_attached');
}

async function prepareStartOrBracket(ctx: PrepareContext, op: 'start_phase' | 'generate_bracket', args: { tournament_id: string; start_round?: boolean }): Promise<Prepared> {
  const { deps } = ctx;
  await deps.guard({ kind: 'tournament', id: args.tournament_id });
  const fact = await deps.source.phaseStart(args.tournament_id);
  if (fact === null) throw new StageRefusal('forbidden');
  phaseFindings(fact, op);

  const route = op === 'start_phase' ? { method: 'POST' as const, routeTemplate: '/api/generate-round/[tid]' } : { method: 'POST' as const, routeTemplate: '/api/tournaments/[id]/generate-bracket' };
  const pathKey = op === 'start_phase' ? 'tid' : 'id';
  const body: Record<string, JsonValue> = op === 'start_phase' && args.start_round === true ? { start_round: true } : {};

  const leagueName = fact.seasonName ?? fact.tournamentName;
  const entity: CardEntity = 'tournament';
  const draftStep: StepDraft = {
    ...baseStep(op, op, route, op === 'start_phase' ? 'round_generated' : 'bracket_generated'),
    entity_type: 'tournament',
    path_params: { [pathKey]: fact.tournamentId },
    query: {},
    body_template: body,
    targets: [{ kind: 'tournament', id: fact.tournamentId }, ...(fact.seasonId === null ? [] : [{ kind: 'season', id: fact.seasonId }])],
    outward_effects: [],
    preconditions: [],
  };
  const target = { kind: 'id' as const, id: fact.tournamentId };
  const specs: PreconditionSpec[] = [
    { read: 'phase_start_state', target },
    { read: 'startup_checklist', target },
    { read: 'channel_set', target },
  ];
  const typed: CardAck | undefined =
    ctx.tool.typedName === 'league' ? { id: 'typed_name', kind: 'typed_name', of: 'league', expected: text(leagueName) } : undefined;
  return prepared(
    ctx,
    draftStep,
    specs,
    {
      step: {
        action: op === 'start_phase' ? 'start' : 'generate_bracket',
        target: { entity, id: fact.tournamentId, name: text(fact.tournamentName), count: fact.participantCount },
        items: [],
        lines: [line('locks_after_start')],
      },
      reversal: 'started',
      existingEntity: !(await ctx.createdInChat([fact.seasonId ?? fact.tournamentId])),
      ack: typed,
      effectKeys: declaredEffects(ctx.tool),
      ids: { tournamentId: fact.tournamentId, seasonId: fact.seasonId },
    },
    `${ctx.tool.name}:${fact.tournamentId}`,
  );
}

export async function prepareGoLive(ctx: PrepareContext, args: unknown): Promise<Prepared> {
  const name = ctx.tool.name;
  if (!isStageableGoLive(name)) throw new StageRefusal('phase_disabled');
  switch (name) {
    case 'propose_publish_ruleset':
      return preparePublishRuleset(ctx, args as Parameters<typeof preparePublishRuleset>[1]);
    case 'propose_move_pin':
      return prepareMovePin(ctx, args as Parameters<typeof prepareMovePin>[1]);
    case 'propose_start_phase':
      return prepareStartOrBracket(ctx, 'start_phase', args as { tournament_id: string; start_round?: boolean });
    case 'propose_generate_bracket':
      return prepareStartOrBracket(ctx, 'generate_bracket', args as { tournament_id: string });
  }
}
