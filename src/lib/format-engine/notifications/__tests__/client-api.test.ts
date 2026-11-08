import { describe, expect, it, vi } from 'vitest';
import { loadInbox, loadUnreadCount, markRead } from '../client-api';

const answering = (data: unknown) =>
  vi.fn(async () => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('the inbox request layer', () => {
  it('asks for a page by offset', async () => {
    const f = answering({ items: [], unread: 0, next_offset: null });
    await loadInbox(30, f);
    expect(f).toHaveBeenCalledWith('/api/notifications?offset=30', expect.objectContaining({ method: 'GET' }));
  });

  it('asks for the count', async () => {
    const f = answering({ unread: 3 });
    await expect(loadUnreadCount(f)).resolves.toEqual({ ok: true, data: { unread: 3 } });
    expect(f).toHaveBeenCalledWith('/api/notifications/unread-count', expect.objectContaining({ method: 'GET' }));
  });

  it('sends the two forms the server accepts', async () => {
    const f = answering({ unread: 0 });
    await markRead(['a'], f);
    await markRead('all', f);
    expect(f.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1].body)).toEqual(['{"ids":["a"]}', '{"all":true}']);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/notifications/read');
  });
});
