/**
 * The turn that is streaming right now, as data. `reduceLive` folds the server's events into it; the transcript renders it
 * under the stored messages until the turn ends, and then the stored messages (re-read from the server) replace it, so a
 * reload at any point shows the same conversation. Nothing here is translated text: tool lines are names and statuses,
 * errors are codes.
 */
import type { AgentEvent } from './types';

export type LiveBlock =
  | { kind: 'text'; step: number; text: string }
  | { kind: 'tool'; id: string; name: string; status: 'running' | 'ok' | 'failed'; code: string | null };

export interface LiveError {
  code: string;
  params?: Record<string, string | number>;
  reason?: string;
}

export interface LiveUsage {
  conversationMicro: number | null;
  warn: boolean;
}

export interface LiveTurn {
  blocks: LiveBlock[];
  /** Proposals staged during this turn (ids only; the card is fetched when it shows). */
  proposalIds: string[];
  planRevision: number | null;
  usage: LiveUsage | null;
  errors: LiveError[];
  done: { reason: string; resumable: boolean } | null;
}

export const emptyLive = (): LiveTurn => ({ blocks: [], proposalIds: [], planRevision: null, usage: null, errors: [], done: null });

/** Never mutates `state`. */
export function reduceLive(state: LiveTurn, event: AgentEvent): LiveTurn {
  switch (event.type) {
    case 'text.delta': {
      const last = state.blocks[state.blocks.length - 1];
      if (last?.kind === 'text' && last.step === event.step) {
        return { ...state, blocks: [...state.blocks.slice(0, -1), { ...last, text: last.text + event.delta }] };
      }
      return { ...state, blocks: [...state.blocks, { kind: 'text', step: event.step, text: event.delta }] };
    }
    case 'tool.start':
      if (state.blocks.some((block) => block.kind === 'tool' && block.id === event.id)) return state;
      return { ...state, blocks: [...state.blocks, { kind: 'tool', id: event.id, name: event.name, status: 'running', code: null }] };
    case 'tool.end': {
      const status = event.ok ? 'ok' : 'failed';
      const exists = state.blocks.some((block) => block.kind === 'tool' && block.id === event.id);
      const blocks: LiveBlock[] = exists
        ? state.blocks.map((block) => (block.kind === 'tool' && block.id === event.id ? { ...block, status, code: event.code ?? null } : block))
        : [...state.blocks, { kind: 'tool', id: event.id, name: event.name, status, code: event.code ?? null }];
      return { ...state, blocks };
    }
    case 'proposal':
      return state.proposalIds.includes(event.id) ? state : { ...state, proposalIds: [...state.proposalIds, event.id] };
    case 'plan.updated':
      return { ...state, planRevision: event.revision };
    case 'usage':
      return { ...state, usage: { conversationMicro: event.conversation_usd_micro, warn: event.warn } };
    case 'error':
      return { ...state, errors: [...state.errors, { code: event.code, ...(event.params ? { params: event.params } : {}), ...(event.reason ? { reason: event.reason } : {}) }] };
    case 'done':
      return { ...state, done: { reason: event.reason, resumable: event.resumable } };
    case 'card':
    case 'action.updated':
      return state;
  }
}
