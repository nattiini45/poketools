/**
 * The pure mappers of the live-format surfaces: they turn the runtime state of a kit league into the DTOs of
 * `view-types.ts` (the player's own view, the admin overview, the pages of checks and adjustments). No I/O and no clock
 * (the caller passes `now`), so every privacy rule is tested without a database.
 *
 * Privacy contract (summarised in docs/format-kit.md, "Live format routes"; this list is the binding one):
 * - every DTO is built by copying NAMED fields; a raw row of `format_action_submissions`, `format_resource_items` or
 *   `format_relation_links` never reaches a response (a submission row carries `target_player_id`, an item row carries
 *   `source` and `source_ref`);
 * - relations go through `visibleLinks`, so a hidden side is `null` and never serialised; the admin overview is masked by
 *   default (the admin may also play), and only `buildUnmasked` (an explicit, audited read) shows the hidden sides;
 * - domain entries go through `visibleEntries`, so an `admins` domain and a locked `when_unlocked` domain ship no entries;
 * - another player's items only for a resource with `visibility: 'all'`; the adjustment history holds to the same rule for an
 *   admin who plays (`adjustmentMaskOf`: a resource adjustment of another player on a resource that is not `all` shows its
 *   kind only). A globally exclusive resource of any visibility
 *   marks an item `taken` on the pickable entries of an action step (the submit already answers `resource_item_taken`, so
 *   the flag is no new fact and saves a refused submit), but the flag carries no holder and no moment, never covers the
 *   viewer's own current pick, and never appears on an entry the viewer may not see (an `admins` or locked pool);
 * - a viewer sees only their own submission and their own challenges; no DTO carries picks of anyone else;
 * - no DTO has a member called `status` (a `players` column; the private-data test helper forbids it), so states are `state`;
 * - a player who is not a current participant is `{ id, name: null }`, rendered "former player", never an empty string.
 *
 * Client-safe in spirit (no server module is imported at runtime) but only the server builds these.
 */
import { evaluate } from '@/lib/format-kit/expr/eval';
import type {
  AdjustKind as KitAdjustKind,
  DomainEntry,
  FormatDefinition,
  PlayerActionRule,
  RelationDef,
  ResourceDef,
  Stage,
} from '@/lib/format-kit/types';
import type { LText } from '@/lib/studio-core/ltext';
import { ltext } from '@/lib/studio-core/ltext';
import type { Json } from '@/types/database';
import { challengeOf } from '../challenge';
import { actorAccess } from './actions';
import { buildLateJoiners, type FiredEventRecord } from './late-joiners';
import { domainView, findDomainView, visibleEntries, type DomainView } from './domains';
import { entryContext, type EnvBase } from './expr-env';
import type { KitContext } from './load';
import { visibleLinks } from './relations';
import { own, type ActionPick, type KitRuntimeState, type RuntimeSubmission } from './types';
import {
  CHALLENGE_STATES,
  SUBMITTABLE_ADJUST_KINDS,
  SUBMISSION_STATES,
  type ActionView,
  type AdjustmentTargets,
  type AdjustmentView,
  type AdminActionView,
  type AdminDomainView,
  type AdminOverview,
  type AdminRelationView,
  type AdminUnmasked,
  type BlockedEntry,
  type ChallengeState,
  type ChallengeView,
  type CheckState,
  type CheckView,
  type DomainEntriesView,
  type EntryView,
  type ItemView,
  type LadderView,
  type PlayerFormatView,
  type PlayerRef,
  type PoolView,
  type RelationLinkView,
  type RelationView,
  type SubmissionState,
  type SubmissionView,
  type StepView,
  type SubmittableAdjustKind,
  type UnmaskedRelationView,
  type ActionWindow,
  type AdjustKind,
} from './view-types';

/** Public names of the CURRENT participants of the league, by player id. A player missing here is a former player. */
export type NameMap = ReadonlyMap<string, string>;

/** The one place a player becomes a `PlayerRef`: an id without a public name is `{ id, name: null }`. */
export function refOf(names: NameMap, id: string): PlayerRef {
  return { id, name: names.get(id) ?? null };
}

const labelOf = (text: LText | undefined, fallbackKey: string): LText => text ?? ltext('en', fallbackKey);

/** The players of one stage's phases, or of every phase (sorted, no repeats): the TS twin of `rosterOf` without its server module. */
function rosterOfPhases(ctx: Pick<KitContext, 'phases'>, stageKey?: string): string[] {
  const phases = stageKey === undefined ? ctx.phases : ctx.phases.filter((phase) => phase.stage.key === stageKey);
  return [...new Set(phases.flatMap((phase) => phase.members))].sort();
}

/**
 * What the masks of the admin reads need: the format, the relation links, and who plays. It is a `KitContext` without the
 * stages, so it can also be read for a league whose engine is not `kit` (see `loadMaskContext`).
 */
export type MaskContext = Pick<KitContext, 'def' | 'state'> & { phases: readonly { members: readonly string[] }[] };

/** Whether `playerId` is enrolled in any phase of the league. */
const playsIn = (ctx: Pick<MaskContext, 'phases'>, playerId: string): boolean => ctx.phases.some((phase) => phase.members.includes(playerId));

/**
 * Whether `playerId` takes part in the league as far as the reader masks are concerned: enrolled in a phase, or still
 * holding a relation link. An admin can remove a player from every phase after the draw, but the links stay (and so can
 * the player's gift), so a recipient who was removed is still a recipient and keeps the masks.
 */
const takesPart = (ctx: Pick<MaskContext, 'phases'> & { state?: Pick<MaskContext['state'], 'links'> }, playerId: string): boolean =>
  playsIn(ctx, playerId) || (ctx.state?.links.some((l) => l.from === playerId || l.to === playerId) ?? false);

const actionRules = (def: Pick<FormatDefinition, 'rules'>): PlayerActionRule[] =>
  def.rules.filter((rule): rule is PlayerActionRule => rule.kind === 'player.action');

// ─── Actions ────────────────────────────────────────────────────────────────────────────────────

/** `locked` = the flag says so; `open` = the flag says so or there is no `opens_on`; else `not_open_yet` (as `isActionWindowOpen`). */
export function windowOf(rule: PlayerActionRule, state: Pick<KitRuntimeState, 'flags'>): ActionWindow {
  const flag = own(state.flags, `action:${rule.id}`);
  if (flag === 'locked') return 'locked';
  if (flag === 'open') return 'open';
  return rule.window.opens_on === undefined ? 'open' : 'not_open_yet';
}

const isSubmissionState = (value: unknown): value is SubmissionState =>
  typeof value === 'string' && (SUBMISSION_STATES as readonly string[]).includes(value);

/** The picks of a stored submission as `{ step, item_id }` pairs; anything that is not one is dropped. */
export function picksOf(value: unknown): ActionPick[] {
  if (!Array.isArray(value)) return [];
  const out: ActionPick[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { step, item_id: itemId } = entry as { step?: unknown; item_id?: unknown };
    if (typeof step === 'number' && Number.isInteger(step) && typeof itemId === 'string') out.push({ step, item_id: itemId });
  }
  return out;
}

/** A stored submission as the viewer's own view of it (named fields: no `target_player_id`, no row id). */
export function toSubmissionView(row: { status: string; picks: unknown }): SubmissionView {
  return { state: isSubmissionState(row.status) ? row.status : 'draft', picks: picksOf(row.picks) };
}

function entryView(entry: DomainEntry): EntryView {
  return { id: entry.id, attrs: entry.attrs.map((attr) => ({ key: attr.key, value: Array.isArray(attr.value) ? [...attr.value] : attr.value })) };
}

/** The viewer's submission of an action (the runtime state holds the submissions of everyone). */
const submissionOf = (state: KitRuntimeState, actionId: string, actor: string): RuntimeSubmission | undefined =>
  state.submissions.find((s) => s.action === actionId && s.actor === actor);

interface ActionBuild {
  view: ActionView;
  /** Domains an actionable step of this action picks from. */
  domains: Set<string>;
}

function buildAction(ctx: KitContext, rule: PlayerActionRule, viewer: string, names: NameMap): ActionBuild {
  const { def, state } = ctx;
  const roster = rosterOfPhases(ctx);
  const window = windowOf(rule, state);
  const submissionRow = submissionOf(state, rule.id, viewer);
  const submission = submissionRow === undefined ? null : toSubmissionView(submissionRow);

  // Access, exactly the rule of `validateActionSubmission` (`actorAccess`): a link AND a place on the roster when the action
  // is `via` a relation, else the roster; plus: the viewer is a current participant. A player who left the league keeps
  // their link and stops being able to act, here as on the server.
  const ownLink = rule.via === undefined ? undefined : state.links.find((l) => l.relation === rule.via && l.from === viewer);
  const hasAccess = actorAccess(rule, viewer, state, roster).ok;
  const accessible = hasAccess && names.has(viewer);
  const actionable = accessible && window === 'open' && submission?.state !== 'locked';

  // The target is displayed through `visibleLinks`, never through the unfiltered links of the state.
  let target: PlayerRef | null = null;
  if (rule.via !== undefined) {
    const relation = (def.relations ?? []).find((r) => r.key === rule.via);
    if (relation !== undefined) {
      const links = state.links.filter((l) => l.relation === rule.via);
      const seen = visibleLinks(relation, links, { playerId: viewer, admin: false }).find((l) => l.from === viewer);
      if (seen?.to != null) target = refOf(names, seen.to);
    }
  }
  const targetHidden = rule.via !== undefined && ownLink !== undefined && target === null;

  const resources = new Map<string, ResourceDef>((def.resources ?? []).map((r) => [r.key, r]));
  const base: EnvBase = { def, state, seed: ctx.seed, scope: `action:${rule.id}` };
  const domains = new Set<string>();
  const steps: StepView[] = rule.steps.map((step, index) => {
    const resource = resources.get(step.resource);
    const domainDef = (def.domains ?? []).find((d) => d.key === step.domain);
    const domainView = findDomainView(def, step.domain, state.flags, state.amendments);
    const blocked: BlockedEntry[] = [];
    // A domain a player may not know of (`admins`, unlisted in `pools`) is not named by its step either: no key, no label,
    // no lock state, and nothing to pick.
    if (domainView?.visibility === 'admins') {
      return {
        index,
        resource: step.resource,
        resource_label: labelOf(resource?.label, step.resource),
        domain: '',
        domain_label: ltext('en', ''),
        count: step.count,
        distinct_attr: step.distinct_attr ?? null,
        unlocked: false,
        blocked,
      };
    }
    if (actionable && domainView !== null) {
      const entries = visibleEntries(domainView, false);
      if (entries.length > 0) domains.add(step.domain);
      const previous = submissionRow;
      const replaced = (item: KitRuntimeState['items'][number]): boolean =>
        item.source === 'action' && previous !== undefined && item.source_ref === previous.id;
      // `taken` is a holder-free flag on the entries this viewer can pick from, for any globally exclusive resource: the
      // submit answers `resource_item_taken` for exactly these items anyway (accepted side channel), and the flag never says
      // who holds one. The viewer's own current pick (`replaced`) is not taken for them. An `own` resource still shows
      // nothing about WHO: `items` / `holder` follow the resource's visibility below.
      const showTaken = resource?.exclusive === 'global';
      const held = new Set(
        showTaken
          ? state.items.filter((i) => i.resource === step.resource && i.item_id !== null && !replaced(i)).map((i) => i.item_id as string)
          : [],
      );
      for (const entry of entries) {
        if (step.where !== undefined) {
          const result = evaluate(step.where, entryContext(base, entry), 'boolean');
          if (!result.ok || result.value !== true) {
            blocked.push({ id: entry.id, reason: 'not_eligible' });
            continue;
          }
        }
        if (held.has(entry.id)) blocked.push({ id: entry.id, reason: 'taken' });
      }
    }
    return {
      index,
      resource: step.resource,
      resource_label: labelOf(resource?.label, step.resource),
      domain: step.domain,
      domain_label: labelOf(domainDef?.label, step.domain),
      count: step.count,
      distinct_attr: step.distinct_attr ?? null,
      unlocked: domainView?.unlocked ?? false,
      blocked,
    };
  });

  return {
    view: {
      id: rule.id,
      label: rule.label,
      window,
      lock: rule.lock,
      accessible,
      actionable,
      target,
      target_hidden: targetHidden,
      steps,
      submission,
    },
    domains,
  };
}

// ─── Relations ──────────────────────────────────────────────────────────────────────────────────

function relationView(relation: RelationDef, links: KitRuntimeState['links'], viewer: { playerId: string | null; admin: boolean }, names: NameMap): RelationView {
  const visible = visibleLinks(relation, links.filter((l) => l.relation === relation.key), viewer);
  const out: RelationLinkView[] = visible.map((link) => ({
    from: link.from === null ? null : refOf(names, link.from),
    to: link.to === null ? null : refOf(names, link.to),
    revealed: link.revealed,
  }));
  return { key: relation.key, label: relation.label, shape: relation.shape, links: out };
}

// ─── Challenges ─────────────────────────────────────────────────────────────────────────────────

/** The fields of a stored challenge the DTO copies. */
export interface ChallengeRecordLike {
  id: string;
  phase_id: string;
  challenger_id: string;
  defender_id: string;
  status: string;
  round: number;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
  match_id: string | null;
}

const isChallengeState = (value: string): value is ChallengeState => (CHALLENGE_STATES as readonly string[]).includes(value);

/** A stored challenge as a DTO; `lapsed` = still `open` but past its accept window (the cron has not marked it yet). */
export function toChallengeView(row: ChallengeRecordLike, names: NameMap, now: Date): ChallengeView {
  const state: ChallengeState = isChallengeState(row.status) ? row.status : 'cancelled';
  return {
    id: row.id,
    phase_id: row.phase_id,
    challenger: refOf(names, row.challenger_id),
    defender: refOf(names, row.defender_id),
    state,
    lapsed: state === 'open' && new Date(row.expires_at).getTime() <= now.getTime(),
    round: row.round,
    created_at: row.created_at,
    expires_at: row.expires_at,
    responded_at: row.responded_at,
    match_id: row.match_id,
  };
}

/** What the loader read for one challenge phase: the stage table, the open round, the ids the viewer may challenge, their challenges. */
export interface LadderInput {
  phaseId: string;
  table: readonly { player_id: string; rank: number }[];
  /** The highest non-completed round of the phase; null = none. */
  round: number | null;
  /** From `challengeTargets()`; a hint, the database decides. */
  targets: readonly string[];
  /** Challenges of the phase in which the viewer is a party (the builder drops any other). */
  challenges: readonly ChallengeRecordLike[];
}

function ladderView(ctx: KitContext, input: LadderInput, viewer: string, names: NameMap, now: Date): LadderView | null {
  const phase = ctx.phases.find((p) => p.id === input.phaseId);
  const config = phase === undefined ? null : challengeOf(phase.stage.pairing);
  if (phase === undefined || config === null) return null;
  const table = [...input.table].sort((a, b) => a.rank - b.rank || (a.player_id < b.player_id ? -1 : 1));
  return {
    phase_id: phase.id,
    stage_key: phase.stage.key,
    stage_label: phase.stage.name,
    round: input.round,
    config: {
      rank_range: config.rank_range,
      max_open: config.max_open,
      cooldown_rounds: config.cooldown_rounds,
      accept_window_hours: config.accept_window_hours,
    },
    table: table.map((row) => ({ player: refOf(names, row.player_id), rank: row.rank })),
    my_rank: table.find((row) => row.player_id === viewer)?.rank ?? null,
    targets: [...input.targets],
    challenges: input.challenges
      .filter((c) => c.challenger_id === viewer || c.defender_id === viewer)
      .map((c) => toChallengeView(c, names, now)),
  };
}

// ─── The player's view ──────────────────────────────────────────────────────────────────────────

/**
 * The whole live view of `viewer` in a running kit league. `ladders` carries what the loader read for each challenge
 * phase. The viewer's own submission, own items, the links `visibleLinks` lets them see, and the entries they may see:
 * nothing else.
 */
export function buildPlayerView(
  ctx: KitContext,
  viewer: string,
  names: NameMap,
  ladders: readonly LadderInput[],
  now: Date,
): PlayerFormatView {
  const { def, state } = ctx;
  const built = actionRules(def).map((rule) => buildAction(ctx, rule, viewer, names));
  const actions = built.map((b) => b.view);

  // Each domain once, only when an actionable step picks from it and the viewer may see its entries.
  const wanted = new Set(built.flatMap((b) => [...b.domains]));
  const domains: DomainEntriesView[] = [];
  for (const domain of def.domains ?? []) {
    if (!wanted.has(domain.key)) continue;
    const view = findDomainView(def, domain.key, state.flags, state.amendments);
    if (view === null) continue;
    const entries = visibleEntries(view, false);
    if (entries.length > 0) domains.push({ key: domain.key, label: domain.label, entries: entries.map(entryView) });
  }

  // Every pool the viewer may know about with its lock state (an `admins` domain stays unlisted): the teambuilder card
  // shows a pool that is not a step of any action, such as one the calendar unlocks later.
  const pools: PoolView[] = domainView(def, state.flags, state.amendments)
    .filter((view) => view.visibility !== 'admins')
    .map((view) => ({ key: view.key, label: labelOf((def.domains ?? []).find((d) => d.key === view.key)?.label, view.key), unlocked: view.unlocked }));

  // Items: the viewer's own always, other players' only for a resource every player may see. Merged per holder and item.
  const resources = new Map<string, ResourceDef>((def.resources ?? []).map((r) => [r.key, r]));
  const merged = new Map<string, ItemView>();
  for (const item of state.items) {
    const resource = resources.get(item.resource);
    const mine = item.player_id === viewer;
    if (!mine && resource?.visibility !== 'all') continue;
    const mapKey = `${item.resource}\u0000${item.item_id ?? ''}\u0000${mine ? '' : item.player_id}`;
    const existing = merged.get(mapKey);
    if (existing !== undefined) {
      existing.amount += item.amount;
      continue;
    }
    merged.set(mapKey, {
      resource: item.resource,
      resource_label: labelOf(resource?.label, item.resource),
      item_id: item.item_id,
      amount: item.amount,
      holder: mine ? null : refOf(names, item.player_id),
    });
  }
  const items = [...merged.values()].sort((a, b) =>
    `${a.resource}\u0000${a.item_id ?? ''}\u0000${a.holder?.id ?? ''}` < `${b.resource}\u0000${b.item_id ?? ''}\u0000${b.holder?.id ?? ''}` ? -1 : 1,
  );

  const relations = (def.relations ?? []).map((relation) => relationView(relation, state.links, { playerId: viewer, admin: false }, names));
  const ladderViews = ladders.flatMap((input) => {
    const view = ladderView(ctx, input, viewer, names, now);
    return view === null ? [] : [view];
  });

  return { running: true, actions, domains, pools, items, relations, ladders: ladderViews };
}

// ─── Admin ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Players who CAN act on an action: current participants on the roster, with a link when the action is `via` a relation.
 * A giver who left the league still holds their link, but they are no actor (`actorAccess`), as for the cron.
 */
function actorsOf(ctx: KitContext, rule: PlayerActionRule, names: NameMap): string[] {
  const roster = rosterOfPhases(ctx);
  const pool =
    rule.via === undefined
      ? roster
      : [...new Set(ctx.state.links.filter((l) => l.relation === rule.via).map((l) => l.from))].sort().filter((id) => roster.includes(id));
  return pool.filter((id) => names.has(id));
}

function adminActionView(ctx: KitContext, rule: PlayerActionRule, names: NameMap): AdminActionView {
  const actors = actorsOf(ctx, rule, names);
  const counts = { missing: 0, draft: 0, submitted: 0, locked: 0 };
  for (const actor of actors) {
    const row = submissionOf(ctx.state, rule.id, actor);
    if (row === undefined) counts.missing += 1;
    else counts[toSubmissionView(row).state] += 1;
  }
  return { id: rule.id, label: rule.label, window: windowOf(rule, ctx.state), lock: rule.lock, actors: actors.length, counts };
}

function adminDomainView(view: DomainView, label: LText | undefined): AdminDomainView {
  return { key: view.key, label: labelOf(label, view.key), visibility: view.visibility, unlocked: view.unlocked, entry_count: view.entries.length };
}

/** The kinds of adjustment the format allows (an `adjust.manual` rule lists them) that the route accepts. */
export function allowedAdjustments(def: Pick<FormatDefinition, 'rules'>): SubmittableAdjustKind[] {
  const allowed = new Set<KitAdjustKind>();
  for (const rule of def.rules) if (rule.kind === 'adjust.manual') for (const kind of rule.allow) allowed.add(kind);
  return SUBMITTABLE_ADJUST_KINDS.filter((kind) => allowed.has(kind));
}

/**
 * The admin overview. Relations are masked exactly as for an ordinary player (the admin's own id as the viewer, not an
 * admin): the admin may also play, and the hidden sides are shown only by `buildUnmasked`. Action counts run over the
 * players who can act, never over the raw roster or the rows of players who left.
 */
export function buildAdminOverview(
  ctx: KitContext,
  adminId: string,
  names: NameMap,
  extra: { openChallenges: number; /** The league's event log (without per-match events); omitted: no late-joiner list. */ events?: readonly FiredEventRecord[] },
): AdminOverview {
  const { def, state } = ctx;
  const labels = new Map((def.domains ?? []).map((d) => [d.key, d.label] as const));
  const relations: AdminRelationView[] = (def.relations ?? []).map((relation) => ({
    ...relationView(relation, state.links, { playerId: adminId, admin: false }, names),
    masked: true,
    link_count: state.links.filter((l) => l.relation === relation.key).length,
  }));
  return {
    running: true,
    actions: actionRules(def).map((rule) => adminActionView(ctx, rule, names)),
    domains: (def.domains ?? []).flatMap((domain) => {
      const view = findDomainView(def, domain.key, state.flags, state.amendments);
      return view === null ? [] : [adminDomainView(view, labels.get(domain.key))];
    }),
    relations,
    open_checks: state.checks.filter((check) => check.status === 'open').length,
    open_challenges: extra.openChallenges,
    allowed_adjustments: allowedAdjustments(def),
    // The players added after one-time events fired, and what those events did for the others: masked like the relations
    // above for an admin who also plays (`buildLateJoiners`).
    late_joiners: buildLateJoiners(ctx, extra.events ?? [], names, { id: adminId, plays: takesPart(ctx, adminId) }),
  };
}

/** The overview of a league that does not run a kit format. */
export const NOT_RUNNING_OVERVIEW: AdminOverview = {
  running: false,
  actions: [],
  domains: [],
  relations: [],
  open_checks: 0,
  open_challenges: 0,
  allowed_adjustments: [],
  late_joiners: [],
};

/**
 * The explicit, audited admin read: relations with their hidden sides, and the state and target of each player's
 * submission per action. No picks and no item rows. Every link and submission row carries `involves_viewer` (the admin
 * who reads is its giver, its recipient or its actor, or is named as its target), which the panel uses to keep an admin
 * who also plays from being spoiled: their own rows are hidden until they choose to show them. An admin who does not
 * play is in no row, so nothing is marked.
 */
export function buildUnmasked(ctx: KitContext, adminId: string, names: NameMap): AdminUnmasked {
  const { def, state } = ctx;
  const relations: UnmaskedRelationView[] = (def.relations ?? []).map((relation) => {
    const view = relationView(relation, state.links, { playerId: adminId, admin: true }, names);
    return {
      ...view,
      links: view.links.map((link) => ({ ...link, involves_viewer: link.from?.id === adminId || link.to?.id === adminId })),
      masked: false,
      link_count: state.links.filter((l) => l.relation === relation.key).length,
    };
  });
  const submissions = actionRules(def).map((rule) => ({
    action: rule.id,
    rows: state.submissions
      .filter((s) => s.action === rule.id && names.has(s.actor))
      .sort((a, b) => (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0))
      .map((s) => ({
        player: refOf(names, s.actor),
        state: toSubmissionView(s).state,
        target: s.target === null ? null : refOf(names, s.target),
        involves_viewer: s.actor === adminId || s.target === adminId,
      })),
  }));
  return { relations, submissions };
}

/** What the adjustment forms choose from: stage rosters, players, resources with the entries they hold, relations, actions. */
export function buildAdjustmentTargets(ctx: KitContext, names: NameMap): AdjustmentTargets {
  const { def, state } = ctx;
  const stages: AdjustmentTargets['stages'] = [];
  const seen = new Set<Stage['key']>();
  for (const phase of ctx.phases) {
    if (seen.has(phase.stage.key)) continue;
    seen.add(phase.stage.key);
    const players = rosterOfPhases(ctx, phase.stage.key).map((id) => refOf(names, id));
    if (players.length > 0) stages.push({ key: phase.stage.key, label: phase.stage.name, players });
  }
  return {
    stages,
    players: rosterOfPhases(ctx).map((id) => refOf(names, id)),
    resources: (def.resources ?? []).map((resource) => {
      const domain = resource.holds.kind === 'domain' ? resource.holds.domain : null;
      const view = domain === null ? null : findDomainView(def, domain, state.flags, state.amendments);
      return {
        key: resource.key,
        label: resource.label,
        holds_domain: domain,
        exclusive: resource.exclusive === 'global',
        items: view === null ? [] : view.entries.map((entry) => entry.id),
      };
    }),
    relations: (def.relations ?? []).map((relation) => ({
      key: relation.key,
      label: relation.label,
      has_links: state.links.some((l) => l.relation === relation.key),
    })),
    actions: actionRules(def).map((rule) => ({ id: rule.id, label: rule.label })),
  };
}

// ─── Checks and adjustments (rows of the history) ──────────────────────────────────────────────

/** The labels of the rules a check or an adjustment names (`check.assisted` and `player.action` rules carry one). */
export function ruleLabelsOf(def: Pick<FormatDefinition, 'rules'>): Map<string, LText> {
  const labels = new Map<string, LText>();
  for (const rule of def.rules) {
    if ((rule.kind === 'check.assisted' || rule.kind === 'player.action') && rule.label !== undefined) labels.set(rule.id, rule.label);
  }
  return labels;
}

/** The fields of a stored check the DTO copies. */
export interface CheckRecordLike {
  id: string;
  source: string;
  rule_id: string;
  subject: Json;
  status: string;
  note: string | null;
  opened_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

const isCheckState = (value: string): value is CheckState => value === 'open' || value === 'confirmed' || value === 'rejected';

const NO_ACTIONS: ReadonlySet<string> = new Set();

/**
 * The actions whose giver is hidden right now: the action runs through a relation whose `from` side is `hidden` and
 * not yet revealed. It depends on the relation alone, never on who asks, so the WRITERS of the audit log (the submit
 * route and the cron auto-pick) use it to decide
 * whether the entry may name the giver. The reader gate lives in `giverHiddenActions`.
 */
export function hiddenGiverActions(ctx: Pick<MaskContext, 'def' | 'state'>): ReadonlySet<string> {
  const hidden = new Set(
    (ctx.def.relations ?? [])
      .filter((relation) => {
        if (relation.visibility.from !== 'hidden') return false;
        const links = ctx.state.links.filter((l) => l.relation === relation.key);
        return !(links.length > 0 && links.every((l) => l.revealed));
      })
      .map((relation) => relation.key),
  );
  const actions = actionRules(ctx.def).filter((rule) => rule.via !== undefined && hidden.has(rule.via));
  return actions.length === 0 ? NO_ACTIONS : new Set(actions.map((rule) => rule.id));
}

/**
 * The actions whose waiting givers an admin must not read off the checks inbox: the viewer takes part in the league (so
 * is a possible recipient: enrolled in a phase or still linked, see `takesPart`) and the action's giver is hidden (see
 * `hiddenGiverActions`). A `deadline_missed` check of such an action names the giver who has not submitted, and for the
 * recipient who is missing a gift that narrows (with one missing giver: names) their Secret Santa without the audited
 * unmask. An admin who neither plays nor holds a link is no recipient and reads the names.
 */
export function giverHiddenActions(ctx: MaskContext, viewerId: string): ReadonlySet<string> {
  return takesPart(ctx, viewerId) ? hiddenGiverActions(ctx) : NO_ACTIONS;
}

/** The subject of a check with the waiting player dropped when it is the giver of a hidden relation (`giver_masked`). */
function maskGiver(row: CheckRecordLike, hiddenActions: ReadonlySet<string>): Json {
  const subject = row.subject;
  if (row.source !== 'deadline_missed' || hiddenActions.size === 0) return subject;
  if (typeof subject !== 'object' || subject === null || Array.isArray(subject)) return subject;
  const { action, player_id: _playerId, players: _players, ...rest } = subject as { [key: string]: Json | undefined };
  if (typeof action !== 'string' || !hiddenActions.has(action)) return subject;
  return { ...rest, action, giver_masked: true } as Json;
}

/** Who reads the checks: the team-visibility facts the `team_audit` redaction needs. */
export interface CheckViewer {
  /** The viewer's player id. */
  id?: string;
  /** A site admin (live `is_admin`): the only admin who may read a hidden team (`team_visibility`). */
  siteAdmin?: boolean;
}

const isRecord = (value: Json | undefined): value is { [key: string]: Json | undefined } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The subject of a `team_audit` check without the planned team it was computed from, unless the viewer may read that
 * team. A planned team (`team_source: 'planned'`, no match link) stays hidden from everyone but its owner and a site
 * admin (`team_visibility`), and a league admin who is not a site admin reads the checks inbox: the species and types
 * of the violated constraints, the species the replay shows off the team and the team id would show it. Left out: the
 * issue details (the codes and Pokémon slots stay), `off_team` (its count stays) and `team_id`; `team_hidden` says so.
 * A team that was linked to the match (`team_source: 'match'`) is public after the match, and a side without a team
 * has nothing to hide. That holds only while the check is open: the link is not frozen in the subject, and a match that is
 * reset unlinks its teams (a planned team again, hidden) and closes its open checks without changing their subject, so a
 * closed check is redacted like a planned team whatever `team_source` it carries.
 */
function redactHiddenTeam(row: CheckRecordLike, viewer: CheckViewer): Json {
  const subject = row.subject;
  if (row.source !== 'team_audit' || viewer.siteAdmin === true || !isRecord(subject)) return subject;
  if (subject.team_source !== 'planned' && !(row.status !== 'open' && subject.team_source === 'match')) return subject;
  if (viewer.id !== undefined && subject.player_id === viewer.id) return subject;
  const { issues, off_team: offTeam, team_id: _teamId, ...rest } = subject;
  return {
    ...rest,
    team_id: null,
    issues: Array.isArray(issues) ? issues.map((issue) => (isRecord(issue) ? { code: issue.code ?? null, params: {}, pokemon_indexes: issue.pokemon_indexes ?? [] } : issue)) : [],
    off_team: [],
    off_team_count: Array.isArray(offTeam) ? offTeam.length : 0,
    team_hidden: true,
  } as Json;
}

/**
 * A stored check as the admin sees it (the `subject` is admin-only: ids and counts built by the engine). `hiddenActions`
 * (from `giverHiddenActions`) are the actions whose waiting giver the viewer may not learn; `viewer` decides whether a
 * planned team in a `team_audit` subject is shown (see `redactHiddenTeam`; without a viewer it is not).
 */
export function toCheckView(
  row: CheckRecordLike,
  ruleLabels: ReadonlyMap<string, LText>,
  names: NameMap,
  hiddenActions: ReadonlySet<string> = NO_ACTIONS,
  viewer: CheckViewer = {},
): CheckView {
  const subject = row.source === 'team_audit' ? redactHiddenTeam(row, viewer) : maskGiver(row, hiddenActions);
  return {
    id: row.id,
    source: row.source,
    rule_id: row.rule_id,
    rule_label: ruleLabels.get(row.rule_id) ?? null,
    subject,
    state: isCheckState(row.status) ? row.status : 'open',
    note: row.note,
    opened_at: row.opened_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by === null ? null : refOf(names, row.resolved_by),
  };
}

/** The fields of a stored adjustment the DTO copies. */
export interface AdjustmentRecordLike {
  id: string;
  kind: string;
  target: Json;
  delta: Json;
  reason: string;
  admin_id: string | null;
  created_at: string;
}

const KINDS: readonly string[] = ['points', 'resource', 'relation', 'outcome', 'action', 'domain', 'rank'];

/**
 * Who reads the adjustment history and which resources the reader may see holdings of. Present only for a reader who plays
 * in the league (so can face the player an adjustment names): a resource adjustment (`target`: resource, player, item;
 * `delta`: amount) of another player on a resource whose visibility is not `all` shows its kind only.
 */
export interface AdjustmentMask {
  viewerId: string;
  /** The keys of the resources with `visibility: 'all'`; any other resource, and one the format no longer defines, is hidden. */
  openResources: ReadonlySet<string>;
}

/**
 * The mask for `viewerId`, or undefined when the viewer does not take part (an admin who is no participant sees
 * everything). A reader who was removed from every phase but still holds a relation link (when `ctx` carries the state)
 * keeps the mask: see `takesPart`.
 */
export function adjustmentMaskOf(
  ctx: (Pick<MaskContext, 'def' | 'phases'> & { state?: Pick<MaskContext['state'], 'links'> }) | null,
  viewerId: string,
): AdjustmentMask | undefined {
  if (ctx === null || !takesPart(ctx, viewerId)) return undefined;
  return { viewerId, openResources: new Set((ctx.def.resources ?? []).filter((resource) => resource.visibility === 'all').map((resource) => resource.key)) };
}

/** Whether `mask` hides the holding a stored resource adjustment names (never the reader's own, never a malformed row's). */
function hidesHolding(kind: string, target: Json, mask: AdjustmentMask | undefined): boolean {
  if (mask === undefined || kind !== 'resource' || typeof target !== 'object' || target === null || Array.isArray(target)) return false;
  const { resource, player_id: playerId } = target as { resource?: Json; player_id?: Json };
  if (playerId === mask.viewerId) return false;
  return typeof resource !== 'string' || !mask.openResources.has(resource);
}

/** A relation adjustment's `links` are hidden pairs: the history keeps only how many there were. */
function redactDelta(kind: string, delta: Json): Json {
  if (kind !== 'relation' || typeof delta !== 'object' || delta === null || Array.isArray(delta)) return delta;
  const { links, ...rest } = delta as { [key: string]: Json | undefined };
  if (!Array.isArray(links)) return delta as Json;
  return { ...rest, link_count: links.length } as Json;
}

/**
 * A stored adjustment as a history row: the reason is the admin's text, relation links are reduced to a count, and the
 * holding of a resource the reader may not see (`AdjustmentMask`) is left out, so the row shows its kind and reason only.
 */
export function toAdjustmentView(row: AdjustmentRecordLike, names: NameMap, mask?: AdjustmentMask): AdjustmentView {
  const hidden = hidesHolding(row.kind, row.target, mask);
  return {
    id: row.id,
    kind: (KINDS.includes(row.kind) ? row.kind : 'points') as AdjustKind,
    target: hidden ? {} : row.target,
    delta: hidden ? {} : redactDelta(row.kind, row.delta),
    reason: row.reason,
    admin: row.admin_id === null ? null : refOf(names, row.admin_id),
    created_at: row.created_at,
  };
}
