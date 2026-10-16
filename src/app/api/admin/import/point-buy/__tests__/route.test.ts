import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  bindSeasonToList: vi.fn(),
  bulkCreateListEntries: vi.fn(),
  createListVersion: vi.fn(),
  isVersionBoundToActiveSeason: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

// The workbook parsing has its own tests; here it is a stand-in.
vi.mock('@/lib/import/xlsx-upload', () => ({
  validateXlsxFile: vi.fn(() => null),
  assertXlsxMagicBytes: vi.fn(() => null),
  fileToBuffer: vi.fn(async () => Buffer.from('PK\u0003\u0004')),
}));

vi.mock('@/lib/import/point-buy-xlsx', () => ({
  validatePointBuyImport: vi.fn(),
  pointBuyEntriesToRows: vi.fn(() => []),
}));

/** The route looks up an existing (name, version) row directly; none exists here. */
vi.mock('@/lib/supabase/client', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return { supabase: { from: vi.fn(() => chain) } };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from '../route';
import { revalidateTag } from 'next/cache';
import { requireAdmin } from '@/lib/auth/helpers';
import { bindSeasonToList, bulkCreateListEntries, createListVersion } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { validatePointBuyImport } from '@/lib/import/point-buy-xlsx';
import { assertXlsxMagicBytes, validateXlsxFile } from '@/lib/import/xlsx-upload';

const VERSION_ID = 'list-v2';
const SEASON_ID = '00000000-0000-4000-8000-000000000005';

function makeRequest(fields: Record<string, string> = {}): NextRequest {
  const form = new FormData();
  form.set('file', new File([Buffer.from('PK\u0003\u0004')], 'list.xlsx'));
  form.set('name', 'EPB');
  form.set('version', '2');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return { formData: vi.fn().mockResolvedValue(form) } as unknown as NextRequest;
}

const expiredTags = () => vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);

/** Stand-in for the reconciliation report the importer builds (its content has its own tests). */
const RECONCILIATION = {
  line_count: 1,
  threshold_conflicts: [
    { line_id: 'dratini--dragonite', field: 'kills_to_stage2', sheet_value: 3, applied_value: 5, source: 'league override' },
  ],
};

describe('POST /api/admin/import/point-buy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(validatePointBuyImport).mockResolvedValue({
      report: {
        total_lines: 1,
        valid: 1,
        imported: 0,
        warnings: [],
        errors: [],
        info: [],
        version_id: null,
        reconciliation: RECONCILIATION,
      },
      validEntries: [],
    } as never);
    vi.mocked(createListVersion).mockResolvedValue({ id: VERSION_ID } as never);
    vi.mocked(bulkCreateListEntries).mockResolvedValue(1);
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, status: 'upcoming', point_buy_list_id: null } as never);
  });

  it("imports the entries and expires that version's cached entries (D37)", async () => {
    const res = await POST(makeRequest());
    const json = await res.json();

    expect(json.data.dry_run).toBe(false);
    // The league matchup page reads the entries from the public read cache.
    expect(expiredTags()).toEqual([`point-buy-list:${VERSION_ID}`]);
    for (const [, profile] of vi.mocked(revalidateTag).mock.calls) expect(profile).toEqual({ expire: 0 });
  });

  it('binding a league also expires its reads: the matchup page finds the version on the league row', async () => {
    await POST(makeRequest({ season_id: SEASON_ID }));

    expect(bindSeasonToList).toHaveBeenCalledWith(SEASON_ID, VERSION_ID);
    expect(expiredTags()).toEqual(expect.arrayContaining([`point-buy-list:${VERSION_ID}`, `season:${SEASON_ID}`]));
  });

  it('a league that is not rebound keeps its reads (only the entries expire)', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, status: 'active', point_buy_list_id: 'list-v1' } as never);

    await POST(makeRequest({ season_id: SEASON_ID }));

    expect(bindSeasonToList).not.toHaveBeenCalled();
    expect(expiredTags()).toEqual([`point-buy-list:${VERSION_ID}`]);
  });

  it('returns the reconciliation report in the response, on a dry run too', async () => {
    const res = await POST(makeRequest({ dry_run: 'true' }));
    const json = await res.json();

    expect(json.data.dry_run).toBe(true);
    expect(json.data.report.reconciliation).toEqual(RECONCILIATION);
    // The report names the uploaded workbook.
    expect(validatePointBuyImport).toHaveBeenCalledWith(expect.any(Buffer), { source: 'list.xlsx' });
  });

  it('a workbook with errors is answered with its report and nothing is written', async () => {
    vi.mocked(validatePointBuyImport).mockResolvedValue({
      report: {
        total_lines: 2,
        valid: 2,
        imported: 0,
        warnings: [],
        errors: ['Duplicate line id dratini--dragonite: lines 1 and 2 (Dratini → Dragonite)'],
        info: [],
        version_id: null,
        reconciliation: RECONCILIATION,
      },
      validEntries: [],
    } as never);

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(json.data.dry_run).toBe(true);
    expect(json.data.report.errors).toHaveLength(1);
    expect(bulkCreateListEntries).not.toHaveBeenCalled();
  });

  it('a dry run writes and expires nothing', async () => {
    await POST(makeRequest({ dry_run: 'true' }));

    expect(bulkCreateListEntries).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  describe('error codes (errors/draft-legacy)', () => {
    it('import_name_required for a blank name', async () => {
      const res = await POST(makeRequest({ name: '  ' }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json).toMatchObject({ success: false, error: 'name is required', code: 'import_name_required' });
    });

    it('import_version_invalid for a non-positive version', async () => {
      const res = await POST(makeRequest({ version: '0' }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json).toMatchObject({ error: 'version must be a positive integer', code: 'import_version_invalid' });
    });

    it('forwards the upload check code and params', async () => {
      vi.mocked(validateXlsxFile).mockReturnValueOnce({
        error: 'File exceeds 8 MB limit',
        code: 'xlsx_file_too_large',
        params: { limit: 8 },
      });

      const res = await POST(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json).toEqual({
        success: false,
        error: 'File exceeds 8 MB limit',
        code: 'xlsx_file_too_large',
        params: { limit: 8 },
      });
      expect(validatePointBuyImport).not.toHaveBeenCalled();
    });

    it('forwards the ZIP header check code', async () => {
      vi.mocked(assertXlsxMagicBytes).mockReturnValueOnce({
        error: 'File is not a valid .xlsx workbook (missing ZIP header)',
        code: 'xlsx_zip_header_missing',
      });

      const res = await POST(makeRequest());
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('xlsx_zip_header_missing');
      expect(json.error).toBe('File is not a valid .xlsx workbook (missing ZIP header)');
    });

    it('season_not_found when the league to bind does not exist', async () => {
      vi.mocked(getSeasonById).mockResolvedValue(null as never);

      const res = await POST(makeRequest({ season_id: SEASON_ID }));
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json).toMatchObject({ error: 'Season not found', code: 'season_not_found' });
    });
  });
});
