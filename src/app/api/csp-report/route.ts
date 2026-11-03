import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logger } from '@/lib/logger';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { cspReportLogLines, readReportJson } from '@/lib/security/csp-report';
import { checkMemoryRateLimit, getClientRateLimitIp, rateLimitedResponse } from '@/lib/utils/rate-limit';

// Public: no auth required
//
// POST /api/csp-report: where the browser sends Content-Security-Policy violation reports (`report-uri` /
// `report-to` of the policies in next.config.mjs and src/proxy.ts; docs/security-patterns.md). It stores nothing: each
// accepted report becomes one capped log line (src/lib/security/csp-report.ts). Browsers send no cookies and no
// credentials, so there is no guard; the limits stand in for one: a per-address in-process cap (no database call, so a
// flood of reports never costs a query), a content-type check and an 8 KB streamed body cap.

const REPORT_LIMIT = { limit: 60, windowSeconds: 60 } as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = await checkMemoryRateLimit('csp-report', getClientRateLimitIp(request), REPORT_LIMIT);
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

    const lines = cspReportLogLines(await readReportJson(request));
    if (lines.length === 0) {
      throw new UserFacingError('Validation failed: body', {
        code: 'validation_failed',
        params: { issues: 'body' },
        status: 400,
      });
    }
    for (const line of lines) logger.warn('csp-report', line);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to record the CSP report');
  }
}
