import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/team-roles', () => ({
  bulkCreateRoles: vi.fn(),
}));

// The workbook parsing has its own tests; here it is a stand-in.
vi.mock('@/lib/import/xlsx-upload', () => ({
  validateXlsxFile: vi.fn(() => null),
  assertXlsxMagicBytes: vi.fn(() => null),
  fileToBuffer: vi.fn(async () => Buffer.from('PK\u0003\u0004')),
}));

vi.mock('@/lib/import/team-roles-xlsx', () => ({
  validateTeamRoleImport: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from '../route';
import { revalidateTag } from 'next/cache';
import { requireAdmin } from '@/lib/auth/helpers';
import { bulkCreateRoles } from '@/lib/supabase/queries/team-roles';
import { validateTeamRoleImport } from '@/lib/import/team-roles-xlsx';
import { assertXlsxMagicBytes, validateXlsxFile } from '@/lib/import/xlsx-upload';

const ROLE = { species_form: 'Garchomp', stage: 3, category: 'hazard_setting', move_name: 'Stealth Rock', source: null };

function report(errors: string[] = []) {
  return { total_raw: 1, unique: 1, warnings: [], errors, by_category: {} } as never;
}

function makeRequest(fields: Record<string, string> = {}): NextRequest {
  const form = new FormData();
  form.set('file', new File([Buffer.from('PK\u0003\u0004')], 'roles.xlsx'));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return { formData: vi.fn().mockResolvedValue(form) } as unknown as NextRequest;
}

describe('POST /api/admin/import/team-roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(validateTeamRoleImport).mockReturnValue({ report: report(), roles: [ROLE] } as never);
    vi.mocked(bulkCreateRoles).mockResolvedValue(1);
  });

  it('imports the roles and expires the cached role catalogue (D37)', async () => {
    const res = await POST(makeRequest());
    const json = await res.json();

    expect(json.data).toMatchObject({ dry_run: false, imported: 1 });
    // The league matchup page reads the catalogue from the public read cache.
    expect(revalidateTag).toHaveBeenCalledWith('team-roles', { expire: 0 });
  });

  it('a dry run writes and expires nothing', async () => {
    const res = await POST(makeRequest({ dry_run: 'true' }));
    const json = await res.json();

    expect(json.data).toMatchObject({ dry_run: true, imported: 0 });
    expect(bulkCreateRoles).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('a workbook with errors writes and expires nothing', async () => {
    vi.mocked(validateTeamRoleImport).mockReturnValue({ report: report(['bad row']), roles: [] } as never);

    await POST(makeRequest());

    expect(bulkCreateRoles).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('forwards the upload check code (errors/draft-legacy)', async () => {
    vi.mocked(validateXlsxFile).mockReturnValueOnce({
      error: 'File must be an .xlsx workbook',
      code: 'xlsx_extension_invalid',
    });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ success: false, error: 'File must be an .xlsx workbook', code: 'xlsx_extension_invalid' });
    expect(validateTeamRoleImport).not.toHaveBeenCalled();
  });

  it('forwards the ZIP header check code (errors/draft-legacy)', async () => {
    vi.mocked(assertXlsxMagicBytes).mockReturnValueOnce({
      error: 'File is not a valid .xlsx workbook (missing ZIP header)',
      code: 'xlsx_zip_header_missing',
    });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('xlsx_zip_header_missing');
    expect(validateTeamRoleImport).not.toHaveBeenCalled();
  });
});
