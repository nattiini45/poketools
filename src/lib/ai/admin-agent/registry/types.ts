/**
 * Shapes of the Admin Assistant tool registry (spec §18.5, plan 3.5, 3.6, 3.9 test 6).
 *
 * A tool is one of five classes (plan 3.5):
 *  - `R` read and `P` pure preview: run in the loop, have an `execute`, never write.
 *  - `D` private reversible write (the Plan, a private Format Studio or Ruleset Studio draft), `B` live rows only
 *    Build or a change card writes, `G` outward-facing or irreversible: model-facing STAGE-ONLY entries. They have no
 *    `execute` here; the loop binds the D writers and `proposals/` stages B and G, so nothing in the registry can reach
 *    a route. `N` (not a tool) is never registered (`not-tools.ts`).
 *
 * This file is type-only (plus the tool-result constructors), so importing it pulls in no database module.
 */
import type { z } from 'zod';
import type { AdminAgentPhase } from '../env';
import type { ApiErrorCode } from '@/i18n/messages/errors';

export type ToolClass = 'R' | 'P' | 'D' | 'B' | 'G';

/** The two registries (plan 6.1): site admins get every tool, resource ("scoped") admins the `any` ones only. */
export type ToolRole = 'site' | 'scoped';

/** Who a tool is offered to. `site` means site admins only (plan 3.6 role column S), `any` every admin tier. */
export type ToolAudience = 'site' | 'any';

/** A Zod object whose keys are the tool's arguments. */
export type ArgsSchema = z.ZodObject<z.ZodRawShape>;

/** The route a D, B or G tool dispatches through (the binding itself lives in `_ops/**`, another module). */
export interface RouteRef {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The Next route path, e.g. `/api/ruleset-definitions/[id]/draft`. */
  readonly path: string;
}

export interface OutwardEffect {
  /** Stable key a Go-live card groups its acknowledgement boxes by (plan 4.5). */
  readonly key: string;
  /** English description for the model and the reviewer. The card text is server-rendered separately. */
  readonly summary: string;
}

/** A catalogued failure. `code` is a key of an error catalog; the model never receives `err.message` (plan 3.3). */
export interface ToolError {
  readonly ok: false;
  readonly code: ApiErrorCode;
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface ToolSuccess<T = unknown> {
  readonly ok: true;
  readonly data: T;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolError;

/**
 * What a tool needs from the loop. Everything here is injected, so the registry is testable without Next and a tool
 * can never reach the current request by itself.
 */
export interface ToolContext {
  /** The registry the call was offered from. */
  readonly role: ToolRole;
  readonly maxPhase: AdminAgentPhase;
  /** Names offered in this conversation's tool set (what `whoami` reports). */
  readonly offeredTools: readonly string[];
  readonly conversationId: string | null;
  readonly now: () => Date;
  /** IANA zone of the viewer (`plc_tz` cookie, default `Europe/Berlin`); the caller resolves it. */
  readonly timeZone: string;
  /** The viewer's UI language (names and descriptions are rendered in it where the engine localises). */
  readonly locale: 'en' | 'de';
  readonly ports: ToolPorts;
}

/** Collaborators that live in other assistant modules. Absent ports make the tool answer `tool_not_available`. */
export interface ToolPorts {
  /** `plans/`: the admin's own Plan of this conversation. Both return a JSON string, size-capped by the tool. */
  readonly plans?: {
    get(input: { adminId: string; conversationId: string }): Promise<string | null>;
    validate(input: { adminId: string; conversationId: string }): Promise<string | null>;
  };
  /**
   * The webhook and social matchers (plan PR5 `previewRecipients`): masked names and counts of the channels an event
   * would reach. Present only once those matchers are exported; never returns URLs or credentials.
   */
  readonly recipients?: {
    preview(input: { eventType: string; tournamentId: string | null; seasonId: string | null }): Promise<{
      discord: { count: number; names: readonly string[] };
      social: { count: number; names: readonly string[] };
    }>;
  };
}

/** Fields every definition has. */
export interface ToolBase {
  /** snake_case, verb first, stable: the list is part of the cached prompt prefix. */
  readonly name: string;
  readonly class: ToolClass;
  /** English, stable bytes: a change is a new `tool_registry_version`. */
  readonly description: string;
  readonly args: ArgsSchema;
  /** Delivery phase that first exposes the tool (`ADMIN_AGENT_MAX_PHASE`). */
  readonly phase: AdminAgentPhase;
  readonly audience: ToolAudience;
}

/** A tool that is registered and described but not built yet (plan 8). Never offered to the model. */
export interface DeferredTool {
  readonly name: string;
  readonly class: ToolClass;
  readonly phase: AdminAgentPhase;
  /** What it waits for: a prerequisite change, another module, or its phase. */
  readonly blockedBy: string;
}

export type ToolVerifyId = string;
