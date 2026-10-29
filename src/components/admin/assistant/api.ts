/**
 * The assistant's requests (spec §18.5). Client components fetch the routes under `/api/admin/agent` and nothing else:
 * no Supabase client, no direct model call. A failed call keeps the server's `error`, `code` and `params` as an
 * `ApiErrorLike`, which the UI renders with `useApiErrorText`; it never stores translated text.
 */
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import type { ApiResult } from '@/types/api';
import type { ConversationDetail, ConversationList, ConversationSeed, ConversationSummary, ProposalDetail, ProposalResultView, ProposalSummaryView } from './types';

const BASE = '/api/admin/agent';

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorLike; status: number };

/** The error of a response that is not a success: the server's own body when it is ours, else a generic one. */
export async function errorOf(response: Response): Promise<ApiErrorLike> {
  try {
    const body: unknown = await response.json();
    const like = toApiErrorLike(body);
    if (like.code !== undefined || like.error !== undefined) return like;
  } catch {
    // not JSON: a proxy page or an empty body
  }
  return { code: 'unknown_error' };
}

async function call<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<CallResult<T>> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      signal,
      headers: { Accept: 'application/json', ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init?.headers },
    });
    if (!response.ok) return { ok: false, error: await errorOf(response), status: response.status };
    const body = (await response.json()) as ApiResult<T>;
    if (!body.success) return { ok: false, error: toApiErrorLike(body), status: response.status };
    return { ok: true, data: body.data };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { ok: false, error: { code: 'network_error' }, status: 0 };
    return { ok: false, error: toApiErrorLike(error), status: 0 };
  }
}

export function listConversations(options: { status?: 'active' | 'archived'; limit?: number; offset?: number } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (options.status !== undefined) query.set('status', options.status);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.offset !== undefined) query.set('offset', String(options.offset));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return call<ConversationList>(`/conversations${suffix}`, undefined, signal);
}

export function createConversation(seed?: ConversationSeed) {
  return call<ConversationSummary>('/conversations', { method: 'POST', body: JSON.stringify(seed === undefined ? {} : { seed }) });
}

export function getConversation(id: string, signal?: AbortSignal) {
  return call<ConversationDetail>(`/conversations/${encodeURIComponent(id)}`, { cache: 'no-store' }, signal);
}

export function getProposal(id: string, signal?: AbortSignal) {
  return call<ProposalDetail>(`/proposals/${encodeURIComponent(id)}`, { cache: 'no-store' }, signal);
}

export function declineProposal(id: string) {
  return call<ProposalSummaryView>(`/proposals/${encodeURIComponent(id)}/decline`, { method: 'POST' });
}

export interface ApproveBody {
  token: string;
  proposal_hash: string;
  preview_hash: string;
  acks: string[];
  /** What was typed for each typed-name acknowledgement, by acknowledgement id; the server compares it with the card. */
  typed?: Record<string, string>;
}

export function approveProposal(id: string, body: ApproveBody) {
  return call<ProposalResultView>(`/proposals/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify(body) });
}

/** Continues a Build left `executing` within its window, under the same approval. The body is empty. */
export function resumeProposal(id: string) {
  return call<ProposalResultView>(`/proposals/${encodeURIComponent(id)}/resume`, { method: 'POST' });
}

/** `undo`: the card's Undo button. The server writes the event the model reads; no text is sent from here. */
export type MessageBody = { text: string; client_msg_id: string } | { continue: true } | { undo: { proposal_id: string } };

/**
 * Posts a turn and hands back the raw response so the caller can read its event stream. A refusal that arrives before the
 * stream starts (busy, rate limit, validation) is a JSON error; use `errorOf` on it.
 */
export function postMessage(conversationId: string, body: MessageBody, signal?: AbortSignal): Promise<Response> {
  return fetch(`${BASE}/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
}
