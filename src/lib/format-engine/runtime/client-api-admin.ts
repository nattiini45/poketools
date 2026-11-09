/**
 * The admin-side request layer of a running kit league: adjustments, checks and the audited relation unmask. Same rules
 * as `client-api.ts` (client-safe, injectable `fetch`, never throws, every path segment URL-encoded, no retries, no body
 * logged); the classifier of `client-api.ts` serves these routes too.
 */
import type { DomainEntry } from '@/lib/format-kit/types';
import { request, type FetchLike, type ApiOutcome } from '@/lib/studio-core/request';
import type {
  AdjustmentCreated,
  AdjustmentsPage,
  AdminUnmasked,
  CheckResolved,
  CheckVerdict,
  ChecksPage,
} from './view-types';

/** A page of a list read (`limit` 1..100, `offset` 0..10000 on the server). */
export interface PageRequest {
  limit: number;
  offset: number;
}

/** The `status` filter of the check list (a QUERY parameter, never a response member). */
export type CheckListFilter = 'open' | 'confirmed' | 'rejected' | 'all';

/** The body of `POST .../adjustments`, as the route reads it (snake_case). `outcome` is not accepted. */
export type AdjustmentRequestBody = {
  reason: string;
  adjustment:
    | { kind: 'points'; stage: string; player_id: string; points: number }
    | { kind: 'rank'; stage: string; order: string[] }
    | { kind: 'resource'; resource: string; player_id: string; item_id?: string | null; amount: number }
    | { kind: 'relation'; relation: string; reveal?: boolean; links?: { from: string; to: string }[]; draw?: boolean }
    | { kind: 'action'; action: string; state: 'open' | 'locked' }
    | { kind: 'domain'; domain: string; add?: DomainEntry[]; remove?: string[] };
};

const base = (seasonId: string): string => `/api/seasons/${encodeURIComponent(seasonId)}/format`;

const pageQuery = (page: PageRequest): string => `limit=${encodeURIComponent(String(page.limit))}&offset=${encodeURIComponent(String(page.offset))}`;

/** `GET /api/seasons/{id}/format/adjustments?limit=&offset=`: the allowed kinds, the form targets and a page of the history. */
export function loadAdjustmentsRequest(seasonId: string, page: PageRequest, f?: FetchLike): Promise<ApiOutcome<AdjustmentsPage>> {
  return request<AdjustmentsPage>(f, 'GET', `${base(seasonId)}/adjustments?${pageQuery(page)}`);
}

/** `POST /api/seasons/{id}/format/adjustments`: apply one adjustment (201). */
export function applyAdjustmentRequest(
  seasonId: string,
  body: AdjustmentRequestBody,
  f?: FetchLike,
): Promise<ApiOutcome<AdjustmentCreated>> {
  return request<AdjustmentCreated>(f, 'POST', `${base(seasonId)}/adjustments`, body);
}

/** `GET /api/seasons/{id}/format/checks?status=&limit=&offset=`: the check history. */
export function loadChecksRequest(
  seasonId: string,
  status: CheckListFilter,
  page: PageRequest,
  f?: FetchLike,
): Promise<ApiOutcome<ChecksPage>> {
  return request<ChecksPage>(f, 'GET', `${base(seasonId)}/checks?status=${encodeURIComponent(status)}&${pageQuery(page)}`);
}

/** `POST /api/seasons/{id}/format/checks/{checkId}/resolve`: confirm or reject an open check (the note is optional). */
export function resolveCheckRequest(
  seasonId: string,
  checkId: string,
  verdict: CheckVerdict,
  note: string | null,
  f?: FetchLike,
): Promise<ApiOutcome<CheckResolved>> {
  const trimmed = note?.trim() ?? '';
  return request<CheckResolved>(f, 'POST', `${base(seasonId)}/checks/${encodeURIComponent(checkId)}/resolve`, {
    verdict,
    ...(trimmed === '' ? {} : { note: trimmed }),
  });
}

/** `POST /api/seasons/{id}/format/relations/unmask`: the relations with their hidden sides and the per-action states. Audited. */
export function unmaskRelationsRequest(seasonId: string, f?: FetchLike): Promise<ApiOutcome<AdminUnmasked>> {
  return request<AdminUnmasked>(f, 'POST', `${base(seasonId)}/relations/unmask`, {});
}
