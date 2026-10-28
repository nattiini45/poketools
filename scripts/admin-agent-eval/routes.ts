/**
 * The admin's clicks, through the REAL route handlers of the assistant (plan 7.1 stage 3 "scripted turns including approve and
 * decline clicks"): `GET /proposals/[id]` for the card and the approval token, `POST .../approve`, `.../decline` and `.../resume`.
 *
 * Each handler is called with a synthetic `NextRequest` that carries what a browser's would for the origin rule (`Origin` equal
 * to the site's, `Sec-Fetch-Site: same-origin`, a JSON body). The identity is the synthetic session the harness installed behind
 * `@/auth` (no cookie), so the live `requireAnyAdmin()` guard, the audience check, the executor and the dispatched routes all run as
 * themselves. Nothing here re-implements a check.
 */
import { NextRequest } from 'next/server';
import { POST as approveRoute } from '@/app/api/admin/agent/proposals/[id]/approve/route';
import { POST as declineRoute } from '@/app/api/admin/agent/proposals/[id]/decline/route';
import { GET as cardRoute } from '@/app/api/admin/agent/proposals/[id]/route';
import { POST as resumeRoute } from '@/app/api/admin/agent/proposals/[id]/resume/route';

const ORIGIN = 'http://localhost:3000';

export interface RouteAnswer {
  status: number;
  /** `ok` for a 2xx, else the catalogued `code` of the error (or `error`). */
  code: string;
  /** The parsed body (`null` when it was not JSON). */
  body: Record<string, unknown> | null;
}

async function answerOf(response: Response): Promise<RouteAnswer> {
  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }
  const code = response.status >= 200 && response.status < 300 ? 'ok' : typeof body?.code === 'string' ? body.code : 'error';
  return { status: response.status, code, body };
}

function request(path: string, method: 'GET' | 'POST', body?: unknown): NextRequest {
  const headers = new Headers({ origin: ORIGIN, 'sec-fetch-site': 'same-origin' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(new URL(path, ORIGIN), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

/** What the card route serves its owner: the card and, while the proposal waits, the token. */
export interface CardAnswer {
  answer: RouteAnswer;
  token: string | null;
  proposalHash: string | null;
  previewHash: string | null;
  acksRequired: string[];
}

export async function readCard(proposalId: string): Promise<CardAnswer> {
  const answer = await answerOf(await cardRoute(request(`/api/admin/agent/proposals/${proposalId}`, 'GET'), withId(proposalId)));
  const data = (answer.body?.data ?? null) as { card?: { proposalHash?: string; previewHash?: string; acksRequired?: string[] }; token?: string | null } | null;
  return {
    answer,
    token: typeof data?.token === 'string' ? data.token : null,
    proposalHash: data?.card?.proposalHash ?? null,
    previewHash: data?.card?.previewHash ?? null,
    acksRequired: Array.isArray(data?.card?.acksRequired) ? data.card.acksRequired : [],
  };
}

/** `POST /approve` with the token and hashes of the card the admin was shown; `ack` false ticks no acknowledgement box. */
export async function approve(proposalId: string, card: CardAnswer, ack: boolean): Promise<RouteAnswer> {
  const body = { token: card.token ?? '0'.repeat(64), proposal_hash: card.proposalHash ?? '0'.repeat(64), preview_hash: card.previewHash ?? '0'.repeat(64), acks: ack ? card.acksRequired : [] };
  return answerOf(await approveRoute(request(`/api/admin/agent/proposals/${proposalId}/approve`, 'POST', body), withId(proposalId)));
}

export async function decline(proposalId: string): Promise<RouteAnswer> {
  return answerOf(await declineRoute(request(`/api/admin/agent/proposals/${proposalId}/decline`, 'POST', {}), withId(proposalId)));
}

export async function resume(proposalId: string): Promise<RouteAnswer> {
  return answerOf(await resumeRoute(request(`/api/admin/agent/proposals/${proposalId}/resume`, 'POST'), withId(proposalId)));
}

/** The proposal status an approve or resume answer reports (`data.status`), or null. */
export function resultStatusOf(answer: RouteAnswer): string | null {
  const data = answer.body?.data;
  return typeof data === 'object' && data !== null && typeof (data as { status?: unknown }).status === 'string' ? (data as { status: string }).status : null;
}
