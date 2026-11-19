import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { CACHE } from '@/lib/api/cache';
import { safeErrorResponse } from '@/lib/api/error-response';
import { wikiModerationNotesQuerySchema, wikiReportsQuerySchema } from '@/lib/validation';
import {
  bindScopedPhaseWikiServices, parseWikiInput, phaseWikiResponse, resolveWikiPhase, type WikiPhaseParams,
} from '../../notes/_lib/route-context';

const queueSchema = z.enum(['notes', 'reports']);
type Context = { params: Promise<WikiPhaseParams & { queue: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const path = await params;
    const scope = await resolveWikiPhase(path, 'read', 'admin');
    if (scope instanceof NextResponse) {
      scope.headers.set('Cache-Control', CACHE.NONE['Cache-Control']);
      return scope;
    }

    const queue = parseWikiInput(queueSchema, path.queue);
    const query = Object.fromEntries(request.nextUrl.searchParams);
    const services = bindScopedPhaseWikiServices(scope, request);
    const phaseId = scope.owner.phase_id;
    if (queue === 'notes') {
      return phaseWikiResponse(await services.moderationQueue(phaseId, parseWikiInput(wikiModerationNotesQuerySchema.strict(), query)));
    }
    return phaseWikiResponse(await services.reports(phaseId, parseWikiInput(wikiReportsQuerySchema.strict(), query)));
  } catch (error) {
    const response = safeErrorResponse(error, 'Failed to list phase wiki moderation queue');
    response.headers.set('Cache-Control', CACHE.NONE['Cache-Control']);
    return response;
  }
}
