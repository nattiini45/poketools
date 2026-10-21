import { describe, expect, it, vi } from 'vitest';
import { readJsonBody } from '../json-body';

describe('readJsonBody', () => {
  it('returns the parsed body', async () => {
    const result = await readJsonBody({ json: vi.fn().mockResolvedValue({ a: 1 }) });
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('turns a parse failure into 400 invalid_json, logged and without echoing the parser message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const parseError = new SyntaxError('Unexpected token s in JSON at position 0');

    const result = await readJsonBody({ json: vi.fn().mockRejectedValue(parseError) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body).toEqual({ success: false, error: 'Invalid JSON body', code: 'invalid_json' });
    expect(JSON.stringify(body)).not.toContain('Unexpected token');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('treats an empty body as invalid JSON, not as an empty object', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await readJsonBody(new Request('http://localhost/x', { method: 'POST', body: '' }));
    expect(result.ok).toBe(false);
    errorSpy.mockRestore();
  });
});
