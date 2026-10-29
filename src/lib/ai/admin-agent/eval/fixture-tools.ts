/**
 * The plan stage's tool runtime: the loop's `ToolRuntime` backed by the fixture world and an in-memory Plan.
 *
 * What is real here: the arguments are parsed by each tool's own Zod schema (so a malformed call fails exactly as it would
 * in production), the Plan edits, readiness and Build steps are the pure `plans/` code, the read answers are checked against
 * the registry's output schemas (`world.test.ts`), and a tool that throws goes through the registry's own error mapping
 * (`toolErrorFromThrown`), so a masked error can be shown to leak or not. What is a stand-in: persistence (the Plan lives in
 * memory), the facts (`world.ts`) and staging (`propose_build` records a proposal; it executes nothing, and an approve
 * click answers 501 `phase_disabled`, the phase 0 behaviour).
 *
 * Every effect a run could have outside the assistant's own tables is recorded as an `EffectEntry`. In phase 0 the only
 * ones this runtime ever records are `stage` and `plan_write`; the grader treats anything else as forbidden, and the
 * executor stage (later) feeds `route_call` and `outward_event` entries from its recorders.
 */
import { applyPlanPatch, applyPlanSetJson, deriveSteps, describePlanEditError, emptyPlan, hashJson, planCode, planFactNeeds, planReadiness, summarizeBuild, validateStepBodies } from '../plans';
import type { PlanDocument, PlanEditError, PlanFacts, PlanReadiness } from '../plans';
import { describeIssues } from '../registry/define';
import { toolError, toolErrorFromThrown } from '../registry/errors';
import type { StagedTool, ToolSet } from '../registry';
import type { ToolResult } from '../registry/types';
import { getAbility, getItem, getMove, getSpecies } from '@/lib/pkmn/dex';
import { fence } from '../registry/fence';
import type { AgentStreamEvent, ToolCallContext, ToolRunResult, ToolRuntime } from '../loop/types';
import type { Json } from '../store/types';
import type { EffectEntry, ProposalRecord } from './types';
import { answerRead, evalUuid, type World } from './world';

/** What the harness knows about one tool call beyond what the transcript holds. */
export interface CallAnnotation {
  name: string;
  class: 'R' | 'P' | 'D' | 'B' | 'G' | null;
  offered: boolean;
  invalidArgs: boolean;
  unmodelled: boolean;
}

export interface FixtureFault {
  tool: string;
  canary: string;
  times: number;
}

export interface FixtureToolsOptions {
  world: World;
  role: 'site' | 'scoped';
  maxPhase: number;
  faults?: readonly FixtureFault[];
  onEffect?: (effect: EffectEntry) => void;
}

const MAX_PLAN_HISTORY = 20;
/** The owned-ruleset cap the Plan's quota fact is checked against (the tool description says 200). */
const RULESET_OWNER_CAP = 200;

const dexExists = (category: string, id: string): boolean => {
  const lookup = category === 'pokemon' ? getSpecies : category === 'moves' ? getMove : category === 'items' ? getItem : getAbility;
  const entity = lookup(id, 9) as { exists?: boolean } | undefined;
  return entity !== undefined && entity.exists !== false;
};

/** The facts `planReadiness` needs, answered from the world exactly where the Plan asks (`planFactNeeds`). */
export function factsFor(world: World, plan: PlanDocument): PlanFacts {
  const needs = planFactNeeds(plan);
  const facts: PlanFacts = {
    rulesetVersions: Object.fromEntries(needs.rulesetVersionIds.map((id) => [id, world.rulesets.some((r) => r.versionId === id) ? ('usable' as const) : ('not_found' as const)])),
    rulesetDefinitions: Object.fromEntries(needs.rulesetDefinitionIds.map((id) => [id, { state: world.rulesets.some((r) => r.definitionId === id) ? ('ok' as const) : ('not_found' as const), diagnosticsErrors: 0 }])),
    rulesetPresets: Object.fromEntries(needs.presetIds.map((id) => [id, { known: world.rulesets.some((r) => r.preset === id) }])),
    dex: Object.fromEntries(needs.dex.map(({ category, id }) => [`${category}:${id}`, dexExists(category, id) ? ('ok' as const) : ('unknown' as const)])),
    players: Object.fromEntries(needs.playerIds.map((id) => [id, world.players.some((p) => p.id === id) ? ({ status: 'ok' as const } as const) : ({ status: 'not_found' as const } as const)])),
    formats: Object.fromEntries(needs.formatDefinitionIds.map((id) => [id, { state: 'not_found' as const }])),
    leagueNameInUse: plan.slots.league !== undefined && world.leagues.some((l) => l.name.toLowerCase() === plan.slots.league!.name.trim().toLowerCase()),
    epbActiveListAvailable: false,
    refs: Object.fromEntries(needs.refKeys.map((key) => [key, 'live' as const])),
  };
  if (needs.needsRulesetQuota) facts.rulesetQuota = { owned: 0, max: RULESET_OWNER_CAP };
  return facts;
}

const issuesOf = (error: PlanEditError): string => describePlanEditError(error);

export class FixtureToolRuntime implements ToolRuntime {
  readonly annotations = new Map<string, CallAnnotation>();
  readonly proposals: ProposalRecord[] = [];
  clarifications = 0;
  private plan: PlanDocument | null = null;
  private revision = 0;
  private readonly history: PlanDocument[] = [];
  private readonly faults: FixtureFault[];
  private lastReadiness: PlanReadiness | null = null;

  constructor(private readonly options: FixtureToolsOptions) {
    this.faults = (options.faults ?? []).map((fault) => ({ ...fault }));
  }

  /** The Plan as it stands, with the readiness of its last validation. */
  snapshot(): { revision: number; doc: Json; ready: boolean | null; blockers: string[] } | null {
    if (this.plan === null) return null;
    return {
      revision: this.revision,
      doc: JSON.parse(JSON.stringify(this.plan)) as Json,
      ready: this.lastReadiness?.ready ?? null,
      blockers: this.lastReadiness?.blockers.map((b) => b.code) ?? [],
    };
  }

  private effect(entry: EffectEntry): void {
    this.options.onEffect?.(entry);
  }

  private readiness(): PlanReadiness {
    const readiness = planReadiness(this.plan!, factsFor(this.options.world, this.plan!));
    this.lastReadiness = readiness;
    return readiness;
  }

  async run(set: ToolSet, call: { name: string; input: unknown }, ctx: ToolCallContext): Promise<ToolRunResult> {
    const definition = set.definitions.get(call.name);
    const annotation: CallAnnotation = { name: call.name, class: definition?.class ?? null, offered: definition !== undefined, invalidArgs: false, unmodelled: false };
    this.annotations.set(ctx.toolUseId, annotation);
    if (definition === undefined) return toolError('tool_not_available');

    const parsed = definition.args.safeParse(call.input);
    if (!parsed.success) {
      annotation.invalidArgs = true;
      return toolError('validation_failed', { issues: describeIssues(parsed.error) });
    }
    const args = parsed.data as Record<string, unknown>;

    const fault = this.faults.find((f) => f.tool === call.name && f.times > 0);
    if (fault !== undefined) {
      fault.times -= 1;
      // The raw error goes through the registry's own mapping: the model must see a catalogued code, never the message.
      return toolErrorFromThrown(new Error(fault.canary), call.name);
    }

    if (definition.class === 'R' || definition.class === 'P') {
      const read = this.read(set, call.name, args, ctx);
      if (read === null) {
        annotation.unmodelled = true;
        return toolError('tool_not_available');
      }
      return read;
    }
    return this.stage(definition as StagedTool, args, ctx, annotation);
  }

  // ─── R and P ───────────────────────────────────────────────────────

  private read(set: ToolSet, name: string, args: Record<string, unknown>, ctx: ToolCallContext): ToolResult | null {
    if (name === 'plan_get') {
      const text = this.plan === null ? '' : JSON.stringify({ revision: this.revision, status: 'draft', doc: this.plan });
      return { ok: true, data: { conversation_bound: true, plan_user_text: fence(text, 48_000), truncated: text.length > 48_000 } };
    }
    if (name === 'plan_validate') {
      if (this.plan === null) return { ok: true, data: { conversation_bound: true, validation_user_text: '', truncated: false } };
      return { ok: true, data: { conversation_bound: true, validation_user_text: fence(JSON.stringify(this.validation()), 48_000), truncated: false } };
    }
    return answerRead(
      { world: this.options.world, now: ctx.now, timeZone: ctx.timeZone, locale: ctx.locale, role: this.options.role, maxPhase: this.options.maxPhase, offeredTools: set.names },
      name,
      args,
    );
  }

  /** What `plan_validate` reports: blockers, warnings, and the Build the Plan would run. Codes and ids only. */
  private validation(): Json {
    const readiness = this.readiness();
    const base = {
      revision: this.revision,
      ready: readiness.ready,
      blockers: readiness.blockers.map((b) => ({ code: b.code, kind: b.kind, section: b.section, path: b.path, params: b.params })),
      warnings: readiness.warnings.map((b) => b.code),
    };
    if (!readiness.ready) return { ...base, build: null } as Json;
    const steps = deriveSteps(this.plan!);
    const summary = summarizeBuild(steps);
    const issues = validateStepBodies(steps);
    return {
      ...base,
      build: { steps: steps.map((s) => ({ key: s.key, op: s.op, class: s.class })), creating: summary.creating, acks: summary.acks },
      step_issues: issues.slice(0, 12).map((i) => ({ step: i.stepKey, path: i.path, code: i.reason })),
    } as Json;
  }

  // ─── D, B and G ────────────────────────────────────────────────────

  private planUpdated(): AgentStreamEvent {
    return { type: 'plan.updated', revision: this.revision };
  }

  private noPlan(): ToolResult {
    return toolError('validation_failed', { issues: 'no_plan: call plan_create first' });
  }

  private commit(next: PlanDocument): void {
    if (this.plan !== null) this.history.push(this.plan);
    if (this.history.length > MAX_PLAN_HISTORY) this.history.shift();
    this.plan = next;
    this.revision += 1;
  }

  private stage(tool: StagedTool, args: Record<string, unknown>, ctx: ToolCallContext, annotation: CallAnnotation): ToolRunResult {
    switch (tool.name) {
      case 'plan_create': {
        if (args.mode === 'amend') {
          annotation.unmodelled = true;
          return toolError('tool_not_available');
        }
        this.history.length = 0;
        this.plan = emptyPlan({ title: String(args.title), intent: 'mixed', contentLocale: ctx.locale });
        this.revision += 1;
        this.lastReadiness = null;
        this.effect({ kind: 'plan_write', name: tool.name });
        return { ok: true, data: { plan_revision: this.revision }, events: [this.planUpdated()] };
      }
      case 'plan_set':
      case 'plan_patch': {
        if (this.plan === null) return this.noPlan();
        const result =
          tool.name === 'plan_set'
            ? applyPlanSetJson(this.plan, { slot: String(args.slot), valueJson: String(args.value_json) })
            : applyPlanPatch(this.plan, String(args.ops_json));
        if (!result.ok) return toolError('validation_failed', { issues: issuesOf(result.error) });
        this.commit(result.plan);
        const readiness = this.readiness();
        this.effect({ kind: 'plan_write', name: tool.name });
        return {
          ok: true,
          data: { plan_revision: this.revision, changed_slots: result.changedSlots, ready: readiness.ready, blockers: readiness.blockers.slice(0, 8).map((b) => b.code) },
          events: [this.planUpdated()],
        };
      }
      case 'plan_revert': {
        const previous = this.history.pop();
        if (previous === undefined) return toolError('validation_failed', { issues: 'nothing_to_revert' });
        this.plan = previous;
        this.revision += 1;
        this.lastReadiness = null;
        this.effect({ kind: 'plan_write', name: tool.name });
        return { ok: true, data: { plan_revision: this.revision }, events: [this.planUpdated()] };
      }
      case 'request_clarification':
        this.clarifications += 1;
        return { ok: true, data: { status: 'waiting_for_admin' } };
      case 'propose_build':
        return this.proposeBuild(args);
      default:
        return this.proposeGoLive(tool, args);
    }
  }

  private newProposal(tool: string, kind: 'build' | 'action', cls: 'B' | 'G', planRevision: number | null): ProposalRecord {
    const record: ProposalRecord = { id: evalUuid('proposal', this.proposals.length + 1), tool, kind, class: cls, planRevision, status: 'staged' };
    // A newer Build of the same Plan replaces the older pending one (plan 4.5 "supersede").
    if (kind === 'build') for (const earlier of this.proposals) if (earlier.kind === 'build' && earlier.status === 'staged') earlier.status = 'superseded';
    this.proposals.push(record);
    this.effect({ kind: 'stage', name: tool, detail: { class: cls, proposal: record.id } });
    return record;
  }

  private proposeBuild(args: Record<string, unknown>): ToolRunResult {
    const refused = (code: string, params?: Record<string, number>, findings?: unknown): ToolRunResult => ({ ok: true, data: { status: 'refused', code, ...(params ? { params } : {}), ...(findings ? { findings } : {}) } as unknown as Json });
    if (this.plan === null) return refused('plan_not_ready');
    if (args.plan_revision !== this.revision) return refused('plan_stale', { revision: this.revision });
    const readiness = this.readiness();
    if (!readiness.ready) {
      const findings = readiness.blockers.slice(0, 12).map((b) => ({ code: b.code, section: b.section, path: b.path, params: b.params }));
      return refused('plan_not_ready', { blockers: readiness.blockers.length }, findings);
    }
    const steps = deriveSteps(this.plan);
    if (steps.length === 0) return refused('plan_not_ready', { blockers: 1 }, [{ code: 'nothing_to_build', section: 'plan', path: '' }]);
    const issues = validateStepBodies(steps);
    if (issues.length > 0) return refused('plan_not_ready', { blockers: issues.length }, issues.slice(0, 12).map((i) => ({ code: i.reason, section: i.stepKey, path: i.path })));
    const summary = summarizeBuild(steps);
    const record = this.newProposal('propose_build', 'build', 'B', this.revision);
    const hash = hashJson({ plan: this.plan, steps: steps.map((s) => s.key) });
    return {
      ok: true,
      data: { status: 'staged', proposal_id: record.id, kind: 'build', class: 'B', plan_code: planCode(hash), expires_at: '2026-10-27T11:00:00.000Z', note: 'not executed; the admin must approve the card' },
      events: [{ type: 'proposal', id: record.id, hash, preview: { kind: 'build', steps: summary.steps, creating: summary.creating, acks: summary.acks } as Json }],
    };
  }

  /** The Go-live tools are not offered before phase 1; a later phase's fixture stages them without running anything. */
  private proposeGoLive(tool: StagedTool, args: Record<string, unknown>): ToolRunResult {
    const record = this.newProposal(tool.name, 'action', 'G', null);
    const hash = hashJson({ tool: tool.name, args });
    return {
      ok: true,
      data: { status: 'staged', proposal_id: record.id, kind: 'action', class: 'G', plan_code: planCode(hash), expires_at: '2026-10-27T10:15:00.000Z', note: 'not executed; the admin must approve the card' },
      events: [{ type: 'proposal', id: record.id, hash, preview: { kind: 'action', tool: tool.name } as Json }],
    };
  }
}
