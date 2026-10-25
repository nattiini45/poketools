/**
 * match-bulk-client: the batch request and the CSV download, against a stubbed fetch. The download goes through a
 * blob URL and an anchor, so `document` and the URL helpers are stubbed too (the suite runs without a DOM).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadMatchExport, fileNameFromDisposition, postMatchBatch } from '../match-bulk-client';
import type { AdminMatchBatchInput, AdminMatchBatchResponse } from '@/lib/admin/match-bulk';

const ID = '00000000-0000-4000-8000-000000000001';
const body: AdminMatchBatchInput = {
  action: 'confirm',
  match_ids: [ID],
  params: { expected: [{ match_id: ID, winner_id: '00000000-0000-4000-8000-0000000000aa', status: 'pending_confirmation' }] },
};

const fetchMock = vi.fn();

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('postMatchBatch', () => {
  it('posts the body as JSON and returns the success data', async () => {
    const data: AdminMatchBatchResponse = {
      action: 'confirm',
      results: [{ id: ID, ok: true, code: 'ok' }],
      summary: { requested: 1, changed: 1, skipped: 0, conflicts: 0, failed: 0 },
    };
    fetchMock.mockResolvedValue(json({ success: true, data }));
    const signal = new AbortController().signal;

    const result = await postMatchBatch(body, signal);

    expect(result).toEqual({ success: true, data });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/matches/batch');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(body);
    expect(init.signal).toBe(signal);
  });

  it('keeps the code and params of an API error body', async () => {
    fetchMock.mockResolvedValue(
      json({ success: false, error: 'Rate limit exceeded', code: 'rate_limited', params: { seconds: 30 } }, 429),
    );
    expect(await postMatchBatch(body)).toEqual({
      success: false,
      error: 'Rate limit exceeded',
      code: 'rate_limited',
      params: { seconds: 30 },
    });
  });

  it('turns a network failure and an unparsable body into network_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await postMatchBatch(body)).toMatchObject({ success: false, code: 'network_error' });

    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await postMatchBatch(body)).toMatchObject({ success: false, code: 'network_error' });
  });
});

describe('fileNameFromDisposition', () => {
  it('reads a quoted file name and falls back without one', () => {
    expect(fileNameFromDisposition('attachment; filename="matches-2026-10-24.csv"')).toBe('matches-2026-10-24.csv');
    expect(fileNameFromDisposition('attachment; filename=matches.csv')).toBe('matches.csv');
    expect(fileNameFromDisposition(null)).toBe('matches.csv');
    expect(fileNameFromDisposition('attachment')).toBe('matches.csv');
  });

  it('never returns a path', () => {
    expect(fileNameFromDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd');
    expect(fileNameFromDisposition('attachment; filename="a/b.csv"')).toBe('b.csv');
  });
});

describe('downloadMatchExport', () => {
  const anchor = { href: '', download: '', style: {} as Record<string, string>, click: vi.fn(), remove: vi.fn() };
  const appendChild = vi.fn();
  let createObjectURL: ReturnType<typeof vi.spyOn>;
  let revokeObjectURL: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    anchor.click.mockReset();
    anchor.remove.mockReset();
    appendChild.mockReset();
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
    createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:matches');
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  function csv(headers: Record<string, string> = {}): Response {
    return new Response('match_id\r\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="matches-2026-10-24-2500-of-3412.csv"',
        'X-Export-Count': '2500',
        'X-Export-Total': '3412',
        'X-Export-Truncated': 'true',
        ...headers,
      },
    });
  }

  it('requests the list query, reads the headers and the file name, and downloads through a blob URL', async () => {
    fetchMock.mockResolvedValue(csv({ 'X-Export-Search-Truncated': 'true' }));
    const signal = new AbortController().signal;

    const result = await downloadMatchExport('status=completed&q=mara', signal);

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/matches/export?status=completed&q=mara', { signal });
    expect(result).toEqual({
      ok: true,
      info: {
        count: 2500,
        total: 3412,
        truncated: true,
        searchTruncated: true,
        fileName: 'matches-2026-10-24-2500-of-3412.csv',
      },
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.href).toBe('blob:matches');
    expect(anchor.download).toBe('matches-2026-10-24-2500-of-3412.csv');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    // Revoked later (see save-blob.test.ts): revoking in the click's own tick can cancel the download.
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('reports a complete export without the truncation flags', async () => {
    fetchMock.mockResolvedValue(
      csv({
        'Content-Disposition': 'attachment; filename="matches-2026-10-24.csv"',
        'X-Export-Count': '312',
        'X-Export-Total': '312',
        'X-Export-Truncated': 'false',
      }),
    );
    const result = await downloadMatchExport('');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/matches/export');
    expect(result).toMatchObject({ ok: true, info: { count: 312, total: 312, truncated: false, searchTruncated: false } });
  });

  it('revokes the blob URL even when the click throws', async () => {
    fetchMock.mockResolvedValue(csv());
    anchor.click.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(await downloadMatchExport('')).toMatchObject({ ok: false });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:matches');
  });

  it('returns a JSON error body as an error and downloads nothing', async () => {
    fetchMock.mockResolvedValue(json({ success: false, error: 'Rate limit exceeded', code: 'rate_limited' }, 429));

    const result = await downloadMatchExport('status=completed');

    expect(result).toEqual({ ok: false, error: { error: 'Rate limit exceeded', code: 'rate_limited', params: undefined } });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it('turns a network failure into network_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await downloadMatchExport('')).toEqual({ ok: false, error: { code: 'network_error' } });
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
