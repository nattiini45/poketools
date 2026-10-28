/**
 * Preparing `propose_build` (plan 4.4, 4.5 staging, 3.3 preflight): the Build proposal of a ready Plan.
 *
 * The model names only the Plan revision. Everything else is derived by code from the stored Plan: the steps
 * (`deriveSteps`), their request bodies (the route-body mapping of `plans/`), the readiness checks, the preflight codes,
 * the fingerprints and the card. Order of the checks: the Plan and its revision, the live guards for everything the Plan
 * names, stored text, the Plan's readiness with live facts, the route schemas on every step body, the checks that need a
 * league built earlier, then provenance of every id. The first failure refuses; nothing is written before all pass.
 */
import { parsePlanDocument, phaseNameKey, type PlanDocument } from '../plans/schema';
import { planReadiness } from '../plans/readiness';
import { BUILD_LIMITS, PLAN_OP_INFO, READ_STATE_DOMAIN, type PlanOp } from '../plans/ops';
import { deriveSteps, summarizeBuild, type PlanStep } from '../plans/steps';
import { validateStepBodies } from '../plans/route-check';
import { scanPlanText } from '../plans/text';
import type { JsonValue } from '@/lib/studio-core/json';
import { buildBuildCard, text, type PinnedRulesetInfo } from './card';
import type { PreconditionSpec, ReadName } from './fingerprints';
import { collectUuids, unknownReferences } from './provenance';
import { StageRefusal, type PrepareContext, type Prepared, type PreparedStep } from './prepare';
import type { HttpMethod, OpRoute } from './steps';
import { scanStagedText } from './text';
import type { StageFinding } from './types';

/** The route each Build op dispatches. The registry's bindings must agree (the approve route refuses a proposal when they differ). */
export const BUILD_OP_ROUTES: Readonly<Record<PlanOp, OpRoute>> = Object.freeze({
  league_create: { method: 'POST', routeTemplate: '/api/seasons' },
  roster_add: { method: 'POST', routeTemplate: '/api/seasons/[id]/participants' },
  phase_create: { method: 'POST', routeTemplate: '/api/seasons/[id]/phases' },
  groups_set: { method: 'PUT', routeTemplate: '/api/seasons/[id]/groups' },
  draft_pool_create: { method: 'POST', routeTemplate: '/api/drafts' },
  tournament_create: { method: 'POST', routeTemplate: '/api/tournaments' },
  tournament_participant_add: { method: 'POST', routeTemplate: '/api/tournaments/[id]/participants' },
}) satisfies Record<PlanOp, { method: HttpMethod; routeTemplate: string }>;

/**
 * The rollout phase whose approve can run each op (spec §18.4). Staging shows a card at phase 0 (approve refuses it then
 * without consuming it); once approve runs, a Build with an op above the cap is refused here instead of being staged and
 * then consumed as `proposal_stale` at approve.
 */
export const BUILD_OP_PHASE: Readonly<Record<PlanOp, number>> = Object.freeze({
  league_create: 1,
  roster_add: 1,
  phase_create: 1,
  groups_set: 2,
  draft_pool_create: 4,
  tournament_create: 1,
  tournament_participant_add: 1,
});

/** A Plan in one of these states may be built (`partial`: a fresh Build for the remainder, plan 4.4). */
const BUILDABLE = new Set(['drafting', 'ready', 'partial']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = Record<string, JsonValue>;

const bodyOf = (step: PlanStep): Body =>
  typeof step.args.body === 'object' && step.args.body !== null && !Array.isArray(step.args.body) ? (step.args.body as Body) : {};

/** A `$ref` or a literal id in a path or body field. */
function targetOfId(value: JsonValue | undefined): { target: { kind: 'id'; id: string } | { kind: 'ref'; ref: string }; scope: string } | null {
  if (typeof value === 'string' && UUID.test(value)) return { target: { kind: 'id', id: value.toLowerCase() }, scope: `season:${value.toLowerCase()}` };
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value.$ref === 'string') {
    return { target: { kind: 'ref', ref: value.$ref }, scope: `season:ref:${value.$ref}` };
  }
  return null;
}

/** The reads that guard a step and the entity keys it changes (plan 4.5 "Preconditions"). */
function preparedStep(step: PlanStep): PreparedStep {
  const body = bodyOf(step);
  const route = BUILD_OP_ROUTES[step.op];
  const season = step.op === 'draft_pool_create' ? targetOfId(body.season_id) : targetOfId(step.args.path.id);
  const specs: PreconditionSpec[] = [];
  for (const read of step.reads as ReadName[]) {
    switch (read) {
      case 'league_name_recent':
      case 'tournament_name_recent':
        specs.push({ read, target: { kind: 'params', params: { name: typeof body.name === 'string' ? body.name : '' } } });
        break;
      case 'epb_battle_ruleset_head':
        specs.push({ read, target: { kind: 'none' } });
        break;
      default:
        // Season-scoped reads of a league that exists (or will exist as a `$ref` of this proposal).
        if (season !== null) specs.push({ read, target: season.target });
    }
  }
  // The entity AND the kind of state the step changes: a later read of another kind of state is still fingerprinted (a phase
  // another admin adds between staging and approve must be seen by the phase step even when a roster step ran before it).
  const touches: string[] = [];
  if (step.op === 'league_create') touches.push(...PLAN_OP_INFO[step.op].changes.map((domain) => `season:ref:league.id#${domain}`));
  else if (step.op !== 'tournament_create' && season !== null) touches.push(...PLAN_OP_INFO[step.op].changes.map((domain) => `${season.scope}#${domain}`));

  const draft = {
    key: step.key,
    op: step.op,
    class: 'B' as const,
    method: route.method,
    route_template: route.routeTemplate,
    path_params: step.args.path,
    query: step.args.query,
    body_template: step.args.body,
    min_role: 'any' as const,
    blocked_by: step.blockedBy,
    entity_type: step.entityType,
    creates: step.creates,
    ref_key: step.refKey,
    verify: step.verify,
    reversal: step.reversal,
    preconditions: [],
    outward_effects: [],
    targets:
      season !== null && season.target.kind === 'id' && step.op !== 'draft_pool_create'
        ? [{ kind: step.op === 'tournament_participant_add' ? 'tournament' : 'season', id: season.target.id }]
        : [],
  };
  return { step: draft, specs, touches };
}

/** Every ruleset VERSION id a step names explicitly (a `$ref` to the league's own pin is not an id the model supplied). */
function versionIds(steps: readonly PlanStep[]): string[] {
  const ids = new Set<string>();
  for (const step of steps) {
    const id = bodyOf(step).ruleset_id;
    if (typeof id === 'string') ids.add(id.toLowerCase());
  }
  return [...ids].sort();
}

const issueSummary = (issues: ReadonlyArray<{ stepKey: string; path: string; reason: string }>): string =>
  issues
    .slice(0, 6)
    .map((issue) => `${issue.stepKey}${issue.path}: ${issue.reason}`)
    .join('; ')
    .slice(0, 300);

export async function prepareBuild(ctx: PrepareContext, args: { plan_revision: number }): Promise<Prepared> {
  const { deps, input, cfg } = ctx;
  const { admin, conversation } = input;

  // 1. The Plan and the revision the model meant.
  const record = await deps.store.plans.getActivePlan(admin.id, conversation.id);
  if (record === null || !BUILDABLE.has(record.status)) throw new StageRefusal('plan_not_ready');
  if (record.revision !== args.plan_revision) throw new StageRefusal('plan_stale', { revision: record.revision });
  const parsed = parsePlanDocument(record.doc);
  if (!parsed.ok) {
    console.error('[admin-agent] propose_build: stored Plan no longer parses', parsed.issues.slice(0, 5));
    throw new StageRefusal('agent_harness_error');
  }
  const plan: PlanDocument = parsed.plan;

  // 2. Live guards for what the Plan names: any admin tier to create, the resource guard for a league built earlier.
  await deps.guard({ kind: 'any' });
  const builtLeague = plan.refs.league?.entity_id;
  if (builtLeague !== undefined) await deps.guard({ kind: 'season', id: builtLeague });
  const builtTournament = plan.refs.tournament?.entity_id;
  if (builtTournament !== undefined) await deps.guard({ kind: 'tournament', id: builtTournament });

  // 3. Stored text (plan 6.3 item 8): refuse before anything else is read.
  const planText = scanPlanText(plan);
  if (planText.length > 0) throw new StageRefusal('text_not_allowed', { path: planText[0].path, reason: planText[0].reason });

  // 4. Readiness with live facts: roster states, ruleset usability, bans, dates, engine gaps, draft combinations.
  const facts = await deps.source.loadPlanFacts({ admin, plan });
  const readiness = planReadiness(plan, facts);
  if (!readiness.ready) {
    const findings: StageFinding[] = readiness.blockers.slice(0, 12).map((blocker) => ({ code: blocker.code, section: blocker.section, path: blocker.path, params: blocker.params }));
    throw new StageRefusal('plan_not_ready', { blockers: readiness.blockers.length }, findings);
  }

  // 5. The steps, by code. An empty Build and an oversized one are refused here, not discovered at approve.
  const steps = deriveSteps(plan);
  if (steps.length === 0) throw new StageRefusal('plan_not_ready', { blockers: 1 }, [{ code: 'nothing_to_build', section: 'plan', path: '' }]);
  const summary = summarizeBuild(steps);
  const maxSteps = Math.min(cfg.limits.maxBuildSteps, BUILD_LIMITS.steps);
  const maxCreates = Math.min(cfg.limits.maxBuildCreates, BUILD_LIMITS.creating);
  if (steps.length > maxSteps || summary.creating > maxCreates) {
    throw new StageRefusal('plan_not_ready', { blockers: 1 }, [{ code: 'build_too_large', section: 'plan', path: '', params: { steps: steps.length, creating: summary.creating } }]);
  }

  const early = cfg.maxPhase >= 1 ? steps.find((step) => BUILD_OP_PHASE[step.op] > cfg.maxPhase) : undefined;
  if (early !== undefined) throw new StageRefusal('phase_disabled', { op: early.op });

  // 6. Every body against the real route schema (placeholders for `$ref`s).
  const bodyIssues = validateStepBodies(steps);
  if (bodyIssues.length > 0) {
    throw new StageRefusal(
      'validation_failed',
      { issues: issueSummary(bodyIssues) },
      bodyIssues.slice(0, 12).map((issue) => ({ code: issue.reason, section: issue.stepKey, path: issue.path })),
    );
  }
  const bodyText = steps.flatMap((step) => scanStagedText(step.args.body));
  if (bodyText.length > 0) throw new StageRefusal('text_not_allowed', { path: bodyText[0].path, reason: bodyText[0].reason });

  // 7. The shared route checks for every ruleset version a step pins: ruleset_not_found, ruleset_forbidden.
  const rulesets = new Map<string, PinnedRulesetInfo>();
  for (const versionId of versionIds(steps)) {
    const guarded = await deps.guard({ kind: 'rulesetUsable', versionId });
    rulesets.set(versionId, {
      versionId,
      versionNo: guarded.usable.version_no,
      slug: guarded.usable.definition.slug,
      visibility: guarded.usable.definition.visibility,
    });
  }

  // 8. Checks against a league built by an earlier Build: a phase name is free there (`PHASE_NAME_TAKEN`).
  if (builtLeague !== undefined) {
    const taken = new Set((await deps.source.existingPhaseNames(builtLeague)).map(phaseNameKey));
    const clashes = steps.filter((step) => step.op === 'phase_create' && typeof bodyOf(step).name === 'string' && taken.has(phaseNameKey(bodyOf(step).name as string)));
    if (clashes.length > 0) {
      throw new StageRefusal(
        'PHASE_NAME_TAKEN',
        { name: text(String(bodyOf(clashes[0]).name)).text },
        clashes.map((step) => ({ code: 'PHASE_NAME_TAKEN', section: step.key, path: '/name' })),
      );
    }
  }

  // 9. Provenance (plan 4.5): every uuid the Build will send is one this conversation has seen; the entities the Plan built
  // itself are exempt (their ids were written by trusted code).
  const exempt = new Set(Object.values(plan.refs).map((ref) => ref.entity_id.toLowerCase()));
  const ids = steps.flatMap((step) => collectUuids({ path: step.args.path, query: step.args.query, body: step.args.body }));
  const unknown = await unknownReferences(ids, exempt, (wanted) => deps.store.refs.knownRefIds(admin.id, conversation.id, wanted));
  if (unknown.length > 0) throw new StageRefusal('unknown_reference', { count: unknown.length, id: unknown[0] });

  // Card inputs that need one more read.
  const needsEpbHead = steps.some((step) => step.effects.some((effect) => effect.kind === 'ensures_battle_ruleset'));
  const epbHead = needsEpbHead ? await deps.source.epbBattleRulesetHead() : null;
  const playerNames: Record<string, string> = {};
  for (const [id, fact] of Object.entries(facts.players ?? {})) if (fact.status === 'ok' && fact.name !== undefined) playerNames[id.toLowerCase()] = fact.name;

  return {
    kind: 'build',
    class: 'B',
    planId: record.id,
    planRevision: record.revision,
    steps: steps.map(preparedStep),
    scopeOf: (spec) => {
      const domain = READ_STATE_DOMAIN[spec.read];
      if (domain === undefined) return null;
      if (spec.target.kind === 'id') return `season:${spec.target.id}#${domain}`;
      if (spec.target.kind === 'ref') return `season:ref:${spec.target.ref}#${domain}`;
      return null;
    },
    acks: [...summary.acks],
    supersedeKey: `build:${record.id}`,
    ttl: 'build',
    card: (planCode) => ({
      ...buildBuildCard({ plan, planId: record.id, planRevision: record.revision, steps, summary, rulesets, epbHead, warnings: readiness.warnings, admin, playerNames }),
      planCode,
    }),
  };
}
