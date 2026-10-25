import { describe, expect, it, vi } from 'vitest';
import { patchTournamentStatus } from '../lifecycle-requests';

const ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

describe('patchTournamentStatus', () => {
  it('PATCHes only the status to the tournament endpoint and resolves null on success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));

    await expect(patchTournamentStatus(ID, 'active', fetchImpl as unknown as typeof fetch)).resolves.toBeNull();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/tournaments/${ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'active' });
  });

  it('can also send completed', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
    await patchTournamentStatus(ID, 'completed', fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ status: 'completed' });
  });

  it('returns the failed API body', async () => {
    const body = { success: false, error: 'Not allowed', code: 'forbidden' };
    const fetchImpl = vi.fn(async () => jsonResponse(body));

    await expect(patchTournamentStatus(ID, 'active', fetchImpl as unknown as typeof fetch)).resolves.toEqual(body);
  });

  it('turns a network failure into an ApiErrorLike', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(patchTournamentStatus(ID, 'active', fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      code: 'network_error',
    });
  });

  it('encodes the id in the path', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
    await patchTournamentStatus('a/b', 'active', fetchImpl as unknown as typeof fetch);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/api/tournaments/a%2Fb');
  });
});
