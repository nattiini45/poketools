/**
 * The browser side of the inbox: one small function per route, over the studio core's `request`. Client-safe. Every function
 * resolves to an `ApiOutcome` and never throws.
 */
import { request, type ApiOutcome, type FetchLike } from '@/lib/studio-core/request';
import type { InboxPage, UnreadCount } from './types';

const BASE = '/api/notifications';

export function loadInbox(offset: number, f?: FetchLike): Promise<ApiOutcome<InboxPage>> {
  return request<InboxPage>(f, 'GET', `${BASE}?offset=${offset}`);
}

export function loadUnreadCount(f?: FetchLike): Promise<ApiOutcome<UnreadCount>> {
  return request<UnreadCount>(f, 'GET', `${BASE}/unread-count`);
}

/** Marks `ids` read, or every notification of the player (`'all'`). Answers the new unread count. */
export function markRead(ids: readonly string[] | 'all', f?: FetchLike): Promise<ApiOutcome<UnreadCount>> {
  return request<UnreadCount>(f, 'POST', `${BASE}/read`, ids === 'all' ? { all: true } : { ids: [...ids] });
}
