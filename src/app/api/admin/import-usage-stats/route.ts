import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { importAllStats, importFormatStats } from '@/lib/smogon/import-stats';
import { getImportableFormats } from '@/lib/smogon/format-registry';
import { getUsageCoverage } from '@/lib/supabase/queries/meta-usage';
import { expirePublicTags, publicTags } from '@/lib/revalidation';

export const maxDuration = 300; // 5 minutes — imports can be large

/** GET — per-format coverage summary (row counts + freshness) for the admin page */
export async function GET() {
  try {
    await requireAdmin();

    const importable = await getImportableFormats();
    const coverage = await getUsageCoverage(importable);

    return NextResponse.json({
      success: true,
      data: {
        formats: coverage,
        imported: coverage.filter((c) => c.rows > 0).length,
        available: importable.length,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch usage coverage');
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();

    const body = await req.json().catch(() => ({}));
    const formats: string[] | undefined = body.formats;

    const start = Date.now();
    const results = formats
      ? await Promise.all(formats.map(importFormatStats))
      : await importAllStats();
    const duration_ms = Date.now() - start;
    // /insights reads imported usage from the public read cache. A failed
    // format may still have written some chunks, so expire on every outcome.
    expirePublicTags([publicTags.metaUsage]);

    const summary = {
      total_formats: results.length,
      success: results.filter((r) => r.status === 'success').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
      total_pokemon: results.reduce((sum, r) => sum + r.pokemonCount, 0),
    };

    return NextResponse.json({
      success: true,
      data: { results, summary, duration_ms },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import usage stats');
  }
}
