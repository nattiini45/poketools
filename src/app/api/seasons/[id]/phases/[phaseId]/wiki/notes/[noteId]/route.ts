import { NextResponse, type NextRequest } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { wikiNoteUpdateSchema } from '@/lib/validation';
import {
  bindScopedPhaseWikiServices, parseWikiInput, phaseWikiResponse, resolveWikiPhase, type WikiNoteParams,
} from '../_lib/route-context';

const editSchema = wikiNoteUpdateSchema.strict();
type Context = { params: Promise<WikiNoteParams> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const path = await params;
    const scope = await resolveWikiPhase(path, 'write');
    if (scope instanceof NextResponse) return scope;

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const { content } = parseWikiInput(editSchema, body.value);
    const { requeued } = await bindScopedPhaseWikiServices(scope, request)
      .edit(scope.owner.phase_id, path.noteId.toLowerCase(), content);
    return phaseWikiResponse({ updated: true, requeued });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update phase wiki note');
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const path = await params;
    const scope = await resolveWikiPhase(path, 'write');
    if (scope instanceof NextResponse) return scope;

    await bindScopedPhaseWikiServices(scope, request).remove(scope.owner.phase_id, path.noteId.toLowerCase());
    return phaseWikiResponse({ deleted: true });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to delete phase wiki note');
  }
}
