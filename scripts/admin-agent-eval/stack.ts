/**
 * The local-stack stages of the Admin Assistant eval (plan 7.1 stages 2 and 3; `--stage exec|e2e`).
 *
 * One case runs the REAL loop (`createConfiguredAgent`, the production wiring of the chat route, with a replayed or live model
 * port and a fixed clock) over the REAL store and the REAL staged tools against the LOCAL Supabase stack, then clicks through the
 * REAL approve, decline and resume routes (`routes.ts`), which run the real executor, the `_ops/g` bindings and the existing
 * route handlers as the synthetic session of the case's actor. The database, the recorders, the ledger and the proposals are read
 * afterwards into a `StackObservation` that the pure grader (`eval/grader-stack.ts`) checks.
 *
 * This file imports the privileged modules the pure harness (`src/lib/ai/admin-agent/eval/`) must not, which is why it lives in
 * `scripts/` and reaches the CLI as an injected `StackHarness`. The entry (`scripts/admin-agent-eval.ts`) loads it only after the
 * environment points at the local stack.
 */
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { createConfiguredAgent } from '@/app/api/admin/agent/_lib/agent';
import { recordHarnessEvent } from '@/app/api/admin/agent/_lib/events';
import { getBindingRegistry } from '@/app/api/admin/agent/_ops/g';
import { authAndRecord } from '@/lib/auth/session-override';
import { parseAdminAgentEnv } from '@/lib/ai/admin-agent/env';
import type { StackHarness } from '@/lib/ai/admin-agent/eval/cli';
import { installEvalSession, installSessionPlayerLoader } from '@/lib/ai/admin-agent/eval/stubs/auth';
import { markApproveStarted, startRecording, stopRecording } from '@/lib/ai/admin-agent/eval/stubs/recorders';
import { EvalClock } from '@/lib/ai/admin-agent/eval/memory-store';
import { TallyPort } from '@/lib/ai/admin-agent/eval/ports';
import { CaseTimeout, droppedThinking, evalAdminId, readEvents, textOfBlocks, toolCallsOf, visibleText, withCeiling, type RunCaseOptions, type RunOutcome } from '@/lib/ai/admin-agent/eval/runner';
import { SNAPSHOT_TABLES, type ApproveRecord, type ClickObservation, type EffectEntry, type EvalCase, type LedgerObservation, type ProposalObservation, type ProposalRecord, type RunRecord, type StackObservation, type TurnRecord } from '@/lib/ai/admin-agent/eval/types';
import { buildWorld, resolvePlaceholders } from '@/lib/ai/admin-agent/eval/world';
import { parseAssistantBlocks } from '@/lib/ai/admin-agent/loop/blocks';
import type { AdminModelPort, AgentStreamEvent } from '@/lib/ai/admin-agent/loop/types';
import { RecordingExhaustedError } from '@/lib/ai/admin-agent/eval/ports';
import { parsePlanDocument, planCode, planReadiness } from '@/lib/ai/admin-agent/plans';
import { loadPlanFacts } from '@/lib/ai/admin-agent/proposals';
import { buildToolSet } from '@/lib/ai/admin-agent/registry';
import { adminAgentStore } from '@/lib/ai/admin-agent/store';
import type { AdminId } from '@/lib/ai/admin-agent/store/ids';
import type { Json, MessageRecord } from '@/lib/ai/admin-agent/store/types';
import { resolvePresetRules } from '@/lib/pkmn/preset-rules.server';
import { getRulesetPreset } from '@/lib/pkmn/ruleset-preset-catalog';
import { createPublished } from '@/lib/ruleset-studio/library';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { supabase } from '@/lib/supabase/client';
import { getSessionPlayerRowByIdentity, toSessionPlayer } from '@/lib/supabase/queries/players';
import { ltext } from '@/lib/studio-core/ltext';
import { loadBaseline, seedFor, type LoadedBaseline, type LoaderDb, type Row, type SeededEntity } from './baseline';
import { installRouteFaults } from './faults';
import { approve, decline, readCard, resultStatusOf, resume, type RouteAnswer } from './routes';

// ─── The database, as plain rows ─────────────────────────────────────

interface Query extends PromiseLike<{ data: Row[] | null; error: { message: string } | null; count?: number | null }> {
  select(columns?: string, options?: { count?: 'exact'; head?: boolean }): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  upsert(rows: Row[], options?: { onConflict?: string }): Query;
  update(values: Row): Query;
}
interface RawClient {
  from(table: string): Query;
}
const raw = supabase as unknown as RawClient;

function check<T extends { error: { message: string } | null }>(label: string, result: T): T {
  // The message of a database error names tables and columns; it goes to the operator's terminal, never to a model.
  if (result.error) throw new Error(`admin-agent eval: ${label} failed: ${result.error.message}`);
  return result;
}

const loaderDb: LoaderDb = {
  async upsert(table, rows, onConflict) {
    if (rows.length === 0) return;
    check(`upsert into ${table}`, await raw.from(table).upsert(rows, { onConflict }));
  },
  async find(table, match) {
    let query = raw.from(table).select('*');
    for (const [column, value] of Object.entries(match)) query = value === null ? query.is(column, null) : query.eq(column, value);
    return check(`read ${table}`, await query).data ?? [];
  },
};

async function countRows(table: string): Promise<number> {
  const result = check(`count ${table}`, await raw.from(table).select('*', { count: 'exact', head: true }));
  return result.count ?? 0;
}

async function snapshotCounts(): Promise<NonNullable<StackObservation['counts']>> {
  const out: NonNullable<StackObservation['counts']> = {};
  for (const table of SNAPSHOT_TABLES) out[table] = { before: await countRows(table), after: 0 };
  return out;
}

// ─── The harness ─────────────────────────────────────────────────────

export interface StackHarnessOptions {
  /** A short tag of this run for seeded names. Default: base-36 of the clock. */
  runTag?: string;
  log?: (line: string) => void;
}

const deferredSession = (name: string, discordId: string): Session => ({
  user: { id: discordId, name },
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  provider: 'discord',
  player: null,
});

const asJsonRow = (row: Row): Record<string, Json> => JSON.parse(JSON.stringify(row)) as Record<string, Json>;

/** Text of the assistant messages stored after `seq`, in order. */
function assistantTextsAfter(messages: readonly MessageRecord[], seq: number): string[] {
  return messages.flatMap((message) => {
    if (message.seq <= seq || message.role !== 'assistant') return [];
    const blocks = parseAssistantBlocks(message.content);
    return blocks ? [textOfBlocks(blocks)] : [];
  });
}

/**
 * Ground truth the code can produce (plan 7.1 "computed, not hand-typed"): `{{computed:preset_pokemon.gen9ou+kingambit}}` is the
 * Pokemon list the catalog implies for the preset, plus the named ids, in the shape the frozen `resolved` rules of a version store.
 */
function computedFor(testCase: EvalCase): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const match of JSON.stringify(testCase.expect).matchAll(/\{\{computed:([A-Za-z0-9_.+-]+)\}\}/g)) {
    const key = match[1];
    const parts = /^preset_pokemon\.([a-z0-9]+)((?:\+[a-z0-9]+)*)$/.exec(key);
    const rules = parts === null ? null : resolvePresetRules(parts[1]);
    if (parts === null || rules === null) throw new Error(`admin-agent eval: cannot compute ${key}`);
    const ids = new Set(rules.pokemon.ids);
    for (const id of parts[2].split('+').filter(Boolean)) ids.add(id);
    out[key] = { mode: rules.pokemon.mode, ids: [...ids].sort() };
  }
  return out;
}

export function createStackHarness(options: StackHarnessOptions = {}): StackHarness {
  const log = options.log ?? (() => undefined);
  const runTag = options.runTag ?? Date.now().toString(36).slice(-4);
  let baseline: LoadedBaseline | null = null;

  const deps = {
    runTag,
    async publishPresetRuleset({ preset, name }: { preset: string; name: string }) {
      return createPublished({
        name: ltext('en', name),
        slugBase: preset,
        document: newRulesetDocument(name, 'en', preset) as unknown as Record<string, unknown>,
        ownerId: null,
        kind: 'preset',
        visibility: 'gallery',
        seasonId: null,
        changelog: ltext('en', 'Seeded by the eval'),
      });
    },
  };

  async function prepare(): Promise<void> {
    // The guards re-read the player live: the stub's loader reads it from the LOCAL `players` table, exactly as `src/auth.ts` does.
    installSessionPlayerLoader(async (provider, identityId) => {
      const row = await getSessionPlayerRowByIdentity(provider, identityId);
      return row ? toSessionPlayer(row) : null;
    });
    baseline = await loadBaseline(loaderDb, deps, (preset) => getRulesetPreset(preset)?.name ?? preset);
    log(`admin-agent eval: baseline loaded (${baseline.players.length} players, ${baseline.rulesets.length} rulesets, run tag ${runTag})`);
  }

  async function runCase(testCase: EvalCase, runOptions: RunCaseOptions): Promise<RunOutcome> {
    if (baseline === null) throw new Error('admin-agent eval: the baseline is not loaded');
    const started = Date.now();
    const repeat = runOptions.repeat ?? 1;
    const world = buildWorld(testCase.fixture, testCase.actor);
    world.rulesets = baseline.rulesets;
    const seededEntities: Record<string, SeededEntity> = {};
    world.dynamic = { seeded: seededEntities, runTag: `${runTag}${repeat}`, computed: computedFor(testCase) };
    const identity = baseline.admins[testCase.actor];
    const adminId = evalAdminId(identity.id);
    const role = testCase.actor === 'site_admin' ? 'site' : 'scoped';
    const clock = new EvalClock(testCase.clock);
    const timeZone = runOptions.timeZone ?? 'Europe/Berlin';

    // The assistant is switched on at the case's phase for this process only (the entry sets the rest).
    process.env.ADMIN_AGENT_MAX_PHASE = String(testCase.phase);
    const config = () => parseAdminAgentEnv();
    const choice = config().models.read;
    const model = runOptions.model ?? choice.model;
    const effort = runOptions.effort ?? choice.effort;

    const session = deferredSession(identity.name, identity.discordId);
    installEvalSession(session);

    const effects: EffectEntry[] = [];
    const turns: TurnRecord[] = [];
    const approvals: ApproveRecord[] = [];
    const clicks: ClickObservation[] = [];
    const allEvents: AgentStreamEvent[] = [];
    let status: RunRecord['status'] = 'ok';
    let failure: string | null = null;
    let conversationId = '';
    let tally: TallyPort | null = null;
    let handle: ReturnType<RunCaseOptions['makePort']> | null = null;
    const turnEnds: number[] = [0];

    const registry = getBindingRegistry();
    const faults = testCase.routeFaults === undefined ? null : installRouteFaults(registry, testCase.routeFaults);
    startRecording();
    let counts: StackObservation['counts'] = {};
    // An object, not a `let`: the click closure assigns it and TypeScript would narrow a local to its initial value.
    const marks: { preApprove: StackObservation['counts'] | null } = { preApprove: null };

    try {
      for (const kind of testCase.seed ?? []) {
        const seeded: SeededEntity = await seedFor(loaderDb, deps, baseline, testCase.id, repeat, kind);
        seededEntities[kind] = seeded;
      }
      counts = await snapshotCounts();

      handle = runOptions.makePort(testCase, world);
      // A recorded model names what an earlier call of the same turn made (`{{ledger:ruleset_create_draft}}`): refresh those ids before each step.
      const inner = handle.port;
      const refreshing: AdminModelPort = {
        async step(input) {
          const rows = await adminAgentStore.actions.listActions(adminId, conversationId, 500);
          const ledgerIds: Record<string, string> = {};
          for (const row of rows) if (row.entity_id !== null) ledgerIds[row.tool_name] = row.entity_id;
          world.dynamic!.ledger = ledgerIds;
          return inner.step(input);
        },
        complete: (input) => inner.complete(input),
      };
      tally = new TallyPort(refreshing);
      const agent = createConfiguredAgent({ port: tally, now: clock.now, config, adapter: { thinkingBlockBinding: 'error', ...runOptions.adapter } });
      const defaults = agent.conversationDefaults({ role, writeCapable: true });
      const conversation = await adminAgentStore.conversations.createConversation(adminId, {
        adminName: identity.name,
        uiLocale: testCase.locale,
        context: {},
        ...defaults,
        model,
        effort,
      });
      conversationId = conversation.id;
      const inbound = new NextRequest(new URL(`/api/admin/agent/conversations/${conversationId}/messages`, 'http://localhost:3000'), { method: 'POST' });

      const newestProposalId = async (): Promise<string | undefined> => (await adminAgentStore.proposals.listProposals(adminId, conversationId, { limit: 1 }))[0]?.id;

      const click = async (turn: number, kind: ClickObservation['kind'], proposalId: string | null, answer: RouteAnswer): Promise<void> => {
        clicks.push({ turn, kind, status: answer.status, code: answer.code, proposalId, result: resultStatusOf(answer) });
        effects.push({ kind: 'approve_attempt', name: kind });
        if (kind === 'approve' || kind === 'approve_no_acks') approvals.push({ turn, status: answer.status, code: answer.code, proposalId });
      };

      const runTurns = async (): Promise<void> => {
        for (const [index, turn] of testCase.turns.entries()) {
          handle!.beginTurn?.(index);
          world.dynamic!.proposalLast = await newestProposalId();
          const before = (await adminAgentStore.messages.loadHistory(adminId, conversationId)).messages;
          const beforeSeq = before.length === 0 ? 0 : before[before.length - 1].seq;

          let input: { kind: 'message'; text: string; clientMsgId: string } | { kind: 'continue' };
          if (turn.undo === true) {
            const target = (await adminAgentStore.proposals.listProposals(adminId, conversationId, { statuses: ['completed', 'partial'] })).find((p) => p.kind !== 'undo');
            if (target === undefined) {
              status = 'error';
              failure = 'undo_without_executed_proposal';
              return;
            }
            await recordHarnessEvent(adminId, conversationId, 'undo_requested', { proposal_id: target.id, plan_code: planCode(target.proposal_hash) });
            input = { kind: 'continue' };
          } else {
            input = { kind: 'message', text: resolvePlaceholders(world, turn.say), clientMsgId: `eval-${testCase.id}-${repeat}-${index}` };
          }

          let startedTurn;
          try {
            // As the chat route does: the session `auth()` answers, recorded, is the only one the dispatch layer will run a route as.
            const recorded = await authAndRecord();
            if (recorded === null) throw new Error('admin-agent eval: no session for the actor');
            startedTurn = await agent.startTurn({ adminId, adminName: identity.name, conversationId, input, locale: testCase.locale, timeZone, role, dispatch: { session: recorded, inbound } });
          } catch (error) {
            status = 'error';
            failure = `start_failed:${(error as { code?: string }).code ?? 'unknown'}`;
            return;
          }
          const [events, outcome] = await Promise.all([readEvents(startedTurn.stream), startedTurn.completion]);
          allEvents.push(...events);
          const history = (await adminAgentStore.messages.loadHistory(adminId, conversationId)).messages;
          turnEnds.push(history.length === 0 ? 0 : history[history.length - 1].seq);
          const done = events.find((e): e is Extract<AgentStreamEvent, { type: 'done' }> => e.type === 'done');
          turns.push({
            say: turn.say,
            answer: [...assistantTextsAfter(history, beforeSeq)].reverse().find((text) => text !== '') ?? '',
            events,
            done: done?.reason ?? outcome.reason,
            resumable: done?.resumable ?? outcome.resumable,
            steps: outcome.steps,
            costUsdMicro: outcome.costUsdMicro,
          });

          // The click: the real routes, with the token and hashes of the card the admin would see.
          if (turn.then === 'approve' || turn.then === 'approve_no_acks' || turn.then === 'double_approve' || turn.then === 'decline') {
            const pending = (await adminAgentStore.proposals.listPendingProposals(adminId, conversationId))[0];
            if (pending === undefined) {
              await click(index, turn.then === 'decline' ? 'decline' : 'approve', null, { status: 404, code: 'proposal_not_found', body: null });
            } else if (turn.then === 'decline') {
              await click(index, 'decline', pending.id, await decline(pending.id));
            } else {
              const card = await readCard(pending.id);
              if (marks.preApprove === null) {
                marks.preApprove = await snapshotCounts();
                markApproveStarted();
              }
              const kind = turn.then === 'approve_no_acks' ? 'approve_no_acks' : 'approve';
              const answers = await Promise.all(Array.from({ length: turn.then === 'double_approve' ? 2 : 1 }, () => approve(pending.id, card, turn.then !== 'approve_no_acks')));
              for (const answer of answers) await click(index, kind, pending.id, answer);
            }
          }

          for (const directive of turn.after ?? []) {
            if (directive.do === 'resume') {
              const executing = (await adminAgentStore.proposals.listProposals(adminId, conversationId, { statuses: ['executing'], limit: 1 }))[0];
              await click(index, 'resume', executing?.id ?? null, executing === undefined ? { status: 404, code: 'proposal_not_found', body: null } : await resume(executing.id));
            } else if (directive.do === 'release_fault') {
              await faults?.release();
            } else {
              const where = resolvePlaceholders(world, directive.where);
              let query = raw.from(directive.table).update(directive.set as Row);
              for (const [column, value] of Object.entries(where)) query = value === null ? query.is(column, null) : query.eq(column, value);
              check(`edit ${directive.table}`, await query);
            }
          }
        }
      };

      try {
        await withCeiling(runTurns(), runOptions.timeoutMs ?? 180_000);
      } catch (error) {
        if (error instanceof CaseTimeout) {
          status = 'timeout';
          failure = 'case_timeout';
        } else {
          status = 'error';
          failure = error instanceof RecordingExhaustedError ? 'recording_exhausted' : 'run_failed';
          console.error('[admin-agent] eval run failed', error);
        }
      }
      if (handle.exhausted === true && status === 'ok') {
        status = 'error';
        failure = 'recording_exhausted';
      }
    } catch (error) {
      status = 'error';
      failure = 'setup_failed';
      console.error('[admin-agent] eval setup failed', error);
    } finally {
      faults?.restore();
    }

    // Observation: the database, the recorders, the ledger and the proposals as the run left them.
    const recorded = stopRecording();
    const messages = conversationId === '' ? [] : (await adminAgentStore.messages.loadHistory(adminId, conversationId)).messages;
    const proposalRows = conversationId === '' ? [] : (await adminAgentStore.proposals.listProposals(adminId, conversationId, { limit: 50 })).reverse();
    const actionRows = conversationId === '' ? [] : await adminAgentStore.actions.listActions(adminId, conversationId, 500);
    for (const table of SNAPSHOT_TABLES) {
      const entry = counts[table];
      if (entry !== undefined) entry.after = await countRows(table);
    }

    const toolSet = buildToolSet({ role, maxPhase: testCase.phase as 0 });
    const toolCalls = turnEnds.slice(1).flatMap((end, index) => {
      const slice = messages.filter((m) => m.seq > turnEnds[index] && m.seq <= end);
      return toolCallsOf(slice, { annotations: new Map() }, toolSet, turns).map((call) => ({ ...call, turn: index, invalidArgs: call.code === 'validation_failed' }));
    });

    const stagedBy = new Map<string, string>();
    for (const call of toolCalls) {
      const result = call.result;
      const data = result !== null && typeof result === 'object' && !Array.isArray(result) ? ((result as Record<string, Json>).data ?? result) : null;
      const id = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, Json>).proposal_id : undefined;
      if (typeof id === 'string' && call.name.startsWith('propose_')) stagedBy.set(id, call.name);
    }
    const proposals: ProposalObservation[] = proposalRows.map((row) => ({ id: row.id, tool: stagedBy.get(row.id) ?? null, kind: row.kind, class: row.class, status: row.status }));
    const ledger: LedgerObservation[] = actionRows.map((row) => ({ proposalId: row.proposal_id, op: row.tool_name, stepKey: row.step_key, status: row.status, code: row.error_code }));

    for (const call of toolCalls) {
      if (call.name.startsWith('plan_')) effects.push({ kind: 'plan_write', name: call.name });
      if (call.name === 'ruleset_create_draft' || call.name === 'ruleset_patch_draft') effects.push({ kind: 'draft_write', name: call.name });
    }
    for (const row of proposalRows) {
      const tool = stagedBy.get(row.id) ?? 'propose_build';
      effects.push({ kind: 'stage', name: tool, detail: { class: row.class, proposal: row.id } });
    }
    // Anything public that happened BEFORE the first approve click is a forbidden effect (the tables of the drafts are the D tools' own).
    for (const event of recorded.beforeApprove) if (event.channel !== 'cache') effects.push({ kind: 'outward_event', name: `${event.channel}:${event.name}` });
    const publicTables = SNAPSHOT_TABLES.filter((table) => !table.startsWith('ruleset_'));
    const firstClickCounts = marks.preApprove;
    if (firstClickCounts !== null) {
      for (const table of publicTables) {
        const seen = firstClickCounts[table];
        const base = counts[table];
        if (seen !== undefined && base !== undefined && seen.before !== base.before) effects.push({ kind: 'route_call', name: `write_before_approve:${table}` });
      }
    }

    // The ids the ledger filed the case's entities under, for `{{ledger:league_create}}` in an expectation.
    const finalLedger: Record<string, string> = {};
    for (const row of actionRows) if (row.entity_id !== null) finalLedger[row.tool_name] = row.entity_id;
    world.dynamic.ledger = finalLedger;

    // Rows the case asked to read, by their case-id names.
    const resolved = resolvePlaceholders(world, testCase.expect);
    const rows: StackObservation['rows'] = [];
    for (const spec of resolved.db?.rows ?? []) {
      let query = raw.from(spec.table).select('*');
      for (const [column, value] of Object.entries(spec.where)) query = value === null ? query.is(column, null) : query.eq(column, value);
      const found = await query;
      rows.push({ table: spec.table, found: found.error ? [] : (found.data ?? []).map(asJsonRow) });
    }

    const plan = await currentPlan(adminId, conversationId, role === 'site');
    const stack: StackObservation = { counts, rows, recorder: recorded, ledger, proposals, clicks };
    const record: RunRecord = {
      caseId: testCase.id,
      repeat,
      model,
      effort,
      status,
      failure,
      durationMs: Date.now() - started,
      turns,
      toolCalls,
      effects,
      plan,
      proposals: proposalRows.map((row): ProposalRecord => ({ id: row.id, tool: stagedBy.get(row.id) ?? 'propose_build', kind: row.kind === 'build' ? 'build' : 'action', class: row.class === 'B' ? 'B' : 'G', planRevision: row.plan_revision, status: row.status === 'superseded' ? 'superseded' : 'staged' })),
      approvals,
      usage: tally?.usage ?? { modelRequests: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, warmInputTokens: 0, warmCacheReadTokens: 0, warmCacheWriteTokens: 0 },
      droppedThinking: tally === null ? 0 : droppedThinking(tally.signatures, { messages }),
      visible: visibleText({ messages }, allEvents),
      stack,
    };
    installEvalSession(null);
    return { record, world, steps: tally?.results ?? [] };
  }

  return {
    prepare,
    runCase,
    async close() {
      installEvalSession(null);
      installSessionPlayerLoader(null);
    },
  };
}

/** The conversation's active Plan with the readiness of the live facts, or null. */
async function currentPlan(adminId: AdminId, conversationId: string, isSiteAdmin: boolean): Promise<RunRecord['plan']> {
  if (conversationId === '') return null;
  const stored = await adminAgentStore.plans.getActivePlan(adminId, conversationId);
  if (stored === null) return null;
  let ready: boolean | null = null;
  let blockers: string[] = [];
  const parsed = parsePlanDocument(stored.doc);
  if (parsed.ok) {
    try {
      const facts = await loadPlanFacts({ admin: { id: adminId, isSiteAdmin }, plan: parsed.plan });
      const readiness = planReadiness(parsed.plan, facts);
      ready = readiness.ready;
      blockers = readiness.blockers.map((b) => b.code);
    } catch (error) {
      console.error('[admin-agent] eval could not read the live facts of the Plan', error);
    }
  }
  return { revision: stored.revision, doc: stored.doc as Json, ready, blockers };
}
