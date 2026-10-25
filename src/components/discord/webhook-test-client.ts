import type { ApiResult } from '@/types/api';

/**
 * Ask the server to post the test embed to one stored webhook. The browser
 * sends only the webhook id: the URL never reaches it after it is saved, and
 * the server loads it, rate limits the call and audits it.
 */
export async function requestWebhookTest(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<{ status: number }>> {
  const res = await fetchImpl(`/api/discord-webhooks/${id}/test`, { method: 'POST' });
  return (await res.json()) as ApiResult<{ status: number }>;
}
