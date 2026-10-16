import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { importAllSets, importGenerationSets } from '@/lib/smogon/import-sets';

export const maxDuration = 300; // 5 minutes

export async function POST(req: Request) {
  try {
    await requireAdmin();

    const body = await req.json().catch(() => ({}));
    const generations: number[] | undefined = body.generations;

    const start = Date.now();
    const results = generations
      ? await Promise.all(generations.map(importGenerationSets))
      : await importAllSets();
    const duration_ms = Date.now() - start;

    const summary = {
      total_generations: results.length,
      success: results.filter((r) => r.status === 'success').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
      total_sets: results.reduce((sum, r) => sum + r.setsCount, 0),
      total_analyses: results.reduce((sum, r) => sum + r.analysesCount, 0),
    };

    return NextResponse.json({
      success: true,
      data: { results, summary, duration_ms },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import sample sets');
  }
}
