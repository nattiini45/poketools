import { NextResponse, type NextRequest } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { wikiNoteReportSchema } from '@/lib/validation';
import {
  bindScopedPhaseWikiServices, parseWikiInput, phaseWikiRateLimit, phaseWikiResponse, resolveWikiPhase,
  type WikiNoteParams,
} from '../../_lib/route-context';

const reportSchema = wikiNoteReportSchema.strict();
type Context = { params: Promise<WikiNoteParams> };

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const path = await params;
    const scope = await resolveWikiPhase(path, 'write');
    if (scope instanceof NextResponse) return scope;

    const limited = await phaseWikiRateLimit('wiki-report', scope.player.playerId);
    if (limited) return limited;
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const input = parseWikiInput(reportSchema, body.value);
    const receipt = await bindScopedPhaseWikiServices(scope, request)
      .report(scope.owner.phase_id, path.noteId.toLowerCase(), input);
    return phaseWikiResponse(receipt, 201);
  } catch (error) {
    return safeErrorResponse(error, 'Failed to report phase wiki note');
  }
}
