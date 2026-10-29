import 'server-only';

/**
 * The Admin Assistant core (plan 3.2, 3.4; spec §18): `createAdminAgent({ ops })` wires the loop to its collaborators.
 *
 * The binding registry arrives by injection, so this core imports no route and is testable without Next. The chat route
 * (`/api/admin/agent/conversations/[id]/messages`) does the request work (live guard, audience check, rate limit, body
 * validation) and then calls `startTurn`:
 *
 *   const { stream, completion } = await agent.startTurn({ adminId, adminName, conversationId, input, locale, timeZone, role });
 *   after(() => completion);                       // spike S7: the loop is not tied to the connection
 *   return new Response(stream, { headers: SSE_HEADERS });
 *
 * Defaults: the bound store, the AI SDK port, the registry's R and P tools, the frozen system prompt, the audit writer.
 * Everything is overridable, which is how the tests and the local-stack eval run the same loop with a fake port.
 */
import { createHmac } from 'node:crypto';
import { requireEnv } from '@/lib/env';
import { logAuditEvent } from '@/lib/audit/log';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { BindingRegistry } from './dispatch/binding';
import { parseAdminAgentEnv, type AdminAgentConfig } from './env';
import { assertLocalDatabase, createAiSdkModelPort, createToolRuntime, DEFAULT_ADAPTER, generateTitle, startTurn, type StagedToolRunner } from './loop';
import type { AdminModelPort, LoopDeps, LoopStore, ProviderAdapterConfig, TurnRequest } from './loop/types';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } from './prompts';
import { buildToolSet, extractResultRefs, runTool } from './registry';
import type { ToolPorts } from './registry/types';
import type { ToolRole, ToolSet } from './registry';
import { adminAgentStore } from './store';
import type { ConversationRecord } from './store/types';
import type { AdminId } from './store/ids';

export interface CreateAdminAgentOptions {
  /** The route bindings (`_ops/**`), injected so the core imports no route. Handed to the stage-only tool runner. */
  ops: BindingRegistry;
  /** The runner of the D, B and G tools (the Plan tools, private draft writes, staging). Absent: they answer `tool_not_available`. */
  runStaged?: StagedToolRunner;
  /** Collaborators of the R and P tools that live in other modules (the Plan reader and validator, the recipient matcher). */
  ports?: ToolPorts;
  store?: LoopStore;
  port?: AdminModelPort;
  /** The provider switches (state channel, strict tools, reasoning replay, cache TTL); see `ProviderAdapterConfig`. */
  adapter?: Partial<ProviderAdapterConfig>;
  config?: () => AdminAgentConfig;
  audit?: LoopDeps['audit'];
  now?: () => Date;
  /** The key the per-conversation sentinel is derived from. Only the `sentinel-user` channel needs it (default `NEXTAUTH_SECRET`). */
  sentinelSecret?: string;
  drift?: LoopDeps['drift'];
}

/** What a new conversation pins at creation (plan 3.4 "Models and effort"): never switched afterwards. */
export interface ConversationDefaults {
  model: string;
  effort: string;
  toolSet: ToolRole;
  toolRegistryVersion: string;
  systemPromptVersion: string;
}

export interface AdminAgent {
  readonly systemPromptVersion: string;
  /** The frozen tool set a conversation of `role` gets under the current `ADMIN_AGENT_MAX_PHASE`. */
  toolSetFor(role: ToolRole): ToolSet;
  /** Model, effort and versions for a new conversation: Opus at `medium` when writes are possible, Sonnet at `medium` for read-only. */
  conversationDefaults(input: { role: ToolRole; writeCapable: boolean }): ConversationDefaults;
  startTurn(request: TurnRequest): ReturnType<typeof startTurn>;
  /** Writes the title of a conversation that has none (best effort; a model call under the same caps). */
  generateTitle(input: { adminId: AdminId; adminName: string; conversation: ConversationRecord; firstUserText: string }): Promise<string | null>;
}

export function createAdminAgent(options: CreateAdminAgentOptions): AdminAgent {
  const config = options.config ?? (() => parseAdminAgentEnv());
  // Before anything else: a hosted database outside a production build is refused (plan 6.2).
  assertLocalDatabase({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, nodeEnv: process.env.NODE_ENV, allowHosted: config().allowHosted });
  const adapter: ProviderAdapterConfig = { ...DEFAULT_ADAPTER, ...options.adapter };
  const store: LoopStore = options.store ?? adminAgentStore;

  const ports: ToolPorts = {
    // The Plan reader works from the store alone. `validate` needs the live facts loaders: the caller passes the port
    // that `staged/` builds (`createPlanPorts`); without it the tool answers `tool_not_available`.
    plans: {
      async get({ adminId, conversationId }) {
        const plan = await store.plans.getActivePlan(adminId as AdminId, conversationId);
        return plan ? JSON.stringify({ revision: plan.revision, status: plan.status, doc: plan.doc }) : null;
      },
      async validate() {
        throw new UserFacingError('Plan validation is not wired into this agent.', { code: 'tool_not_available', status: 404 });
      },
    },
    ...options.ports,
  };

  const deps: LoopDeps = {
    store,
    port: options.port ?? createAiSdkModelPort({ adapter }),
    tools: createToolRuntime({
      runTool,
      ports,
      ops: options.ops,
      // Provenance (plan 6.3): the typed ids of every read are recorded, so a write may name them.
      resultRefs: (definition, data) =>
        definition.class === 'R' || definition.class === 'P'
          ? extractResultRefs(definition, data).map((ref) => ({ kind: ref.kind, id: ref.id, label: ref.label, source: 'tool_result' as const }))
          : [],
      ...(options.runStaged ? { runStaged: options.runStaged } : {}),
    }),
    buildToolSet,
    systemPrompt: { text: SYSTEM_PROMPT, version: SYSTEM_PROMPT_VERSION },
    config,
    audit: options.audit ?? logAuditEvent,
    now: options.now ?? (() => new Date()),
    sentinelFor(conversationId) {
      // Domain-separated from every other use of the secret by the label below.
      const secret = options.sentinelSecret ?? requireEnv('NEXTAUTH_SECRET');
      return createHmac('sha256', secret).update(`admin-agent:sentinel:${conversationId}`).digest('hex').slice(0, 12);
    },
    ...(options.drift ? { drift: options.drift } : {}),
    stateChannel: adapter.stateChannel,
  };

  return {
    systemPromptVersion: deps.systemPrompt.version,
    toolSetFor: (role) => buildToolSet({ role, maxPhase: deps.config().maxPhase }),
    conversationDefaults({ role, writeCapable }) {
      const current = deps.config();
      const choice = writeCapable ? current.models.write : current.models.read;
      return {
        model: choice.model,
        effort: choice.effort,
        toolSet: role,
        toolRegistryVersion: buildToolSet({ role, maxPhase: current.maxPhase }).registryVersion,
        systemPromptVersion: deps.systemPrompt.version,
      };
    },
    startTurn: (request) => startTurn(deps, request),
    generateTitle: (input) => generateTitle(deps, input),
  };
}

export { SYSTEM_PROMPT_VERSION } from './prompts';
export { SSE_HEADERS, AdminAgentLoopError, hasUnconsumedHarnessEvent, harnessEventMessage, LOOP_EVENTS } from './loop';
export type { AgentStreamEvent, StartedTurn, StagedToolContext, StagedToolRunner, TurnInput, TurnOutcome, TurnRequest } from './loop';
