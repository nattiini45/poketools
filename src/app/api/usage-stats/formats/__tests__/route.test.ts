import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/meta-usage', () => ({
  getAvailableFormats: vi.fn(),
  getLastImportDate: vi.fn(),
}));

import { GET } from '../route';
import {
  getAvailableFormats,
  getLastImportDate,
} from '@/lib/supabase/queries/meta-usage';

const mockGetFormats = getAvailableFormats as ReturnType<typeof vi.fn>;
const mockGetLastImport = getLastImportDate as ReturnType<typeof vi.fn>;

describe('GET /api/usage-stats/formats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formats and last import date', async () => {
    const formats = ['gen9ou', 'gen9uu', 'gen9vgc2024'];
    const lastImported = new Date('2025-06-01T12:00:00Z');
    mockGetFormats.mockResolvedValue(formats);
    mockGetLastImport.mockResolvedValue(lastImported);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.formats).toEqual(formats);
    expect(json.data.last_imported).toBe('2025-06-01T12:00:00.000Z');
  });

  it('returns null last_imported when no import date', async () => {
    mockGetFormats.mockResolvedValue([]);
    mockGetLastImport.mockResolvedValue(null);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.formats).toEqual([]);
    expect(json.data.last_imported).toBeNull();
  });

  it('returns 500 with safe fallback when query throws', async () => {
    mockGetFormats.mockRejectedValue(new Error('connection timeout'));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    // safeErrorResponse hides internal error details
    expect(json.error).toBe('Failed to fetch formats');
  });

  it('returns 500 with safe fallback for non-Error when query throws', async () => {
    mockGetFormats.mockRejectedValue('something broke');

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    // safeErrorResponse hides internal error details
    expect(json.error).toBe('Failed to fetch formats');
  });
});
