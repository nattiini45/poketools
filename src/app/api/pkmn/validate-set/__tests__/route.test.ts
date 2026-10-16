import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  validateSetLegality: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn().mockImplementation((_err: unknown, msg: string) =>
    NextResponse.json({ success: false, error: msg }, { status: 500 }),
  ),
}));

import { POST } from '../route';
import { validateSetLegality } from '@/lib/pkmn/dex';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockValidate = validateSetLegality as ReturnType<typeof vi.fn>;
const mockSafeError = safeErrorResponse as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost:3000/api/pkmn/validate-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/pkmn/validate-set', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates a legal set successfully', async () => {
    const result = { legal: true, problems: [] };
    mockValidate.mockResolvedValue(result);

    const res = await POST(makeRequest({
      species: 'Garchomp',
      ability: 'Rough Skin',
      moves: ['Earthquake', 'Dragon Claw'],
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(result);
    expect(mockValidate).toHaveBeenCalledWith('Garchomp', 'Rough Skin', ['Earthquake', 'Dragon Claw']);
  });

  it('returns 400 when species is missing', async () => {
    const res = await POST(makeRequest({ ability: 'Rough Skin' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('species');
  });

  it('defaults ability to empty string and moves to empty array', async () => {
    mockValidate.mockResolvedValue({ legal: true, problems: [] });

    await POST(makeRequest({ species: 'Garchomp' }));

    expect(mockValidate).toHaveBeenCalledWith('Garchomp', '', []);
  });

  it('uses safeErrorResponse on unexpected errors', async () => {
    const err = new Error('unexpected');
    mockValidate.mockRejectedValue(err);

    await POST(makeRequest({ species: 'Garchomp' }));

    expect(mockSafeError).toHaveBeenCalledWith(err, 'Failed to validate set');
  });
});
