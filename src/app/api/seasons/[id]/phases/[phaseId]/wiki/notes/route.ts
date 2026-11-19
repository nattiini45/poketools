import { NextResponse, type NextRequest } from 'next/server';
import { CACHE } from '@/lib/api/cache';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { phaseWikiNoteCreateSchema } from '@/lib/wiki/phase-services';
import {
  bindScopedPhaseWikiServices, parseWikiInput, phaseWikiRateLimit, phaseWikiResponse, resolveWikiPhase,
  type WikiPhaseParams,
} from './_lib/route-context';

const entityQuery = phaseWikiNoteCreateSchema.pick({ entity_type: true, entity_name: true });
type Context = { params: Promise<WikiPhaseParams> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const scope = await resolveWikiPhase(await params, 'read');
    if (scope instanceof NextResponse) {
      scope.headers.set('Cache-Control', CACHE.NONE['Cache-Control']);
      return scope;
    }

    const { entity_type, entity_name } = parseWikiInput(entityQuery, Object.fromEntries(request.nextUrl.searchParams));
    const notes = await bindScopedPhaseWikiServices(scope, request).approved(
      scope.owner.phase_id, { type: entity_type, name: entity_name },
    );
    return phaseWikiResponse(notes);
  } catch (error) {
    const response = safeErrorResponse(error, 'Failed to fetch phase wiki notes');
    response.headers.set('Cache-Control', CACHE.NONE['Cache-Control']);
    return response;
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const scope = await resolveWikiPhase(await params, 'write');
    if (scope instanceof NextResponse) return scope;

    const limited = await phaseWikiRateLimit('wiki-notes', scope.player.playerId);
    if (limited) return limited;
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const input = parseWikiInput(phaseWikiNoteCreateSchema, body.value);

    const note = await bindScopedPhaseWikiServices(scope, request).create(scope.owner.phase_id, input);
    return phaseWikiResponse({
      id: note.id, phase_id: note.phase_id, approved: note.approved,
      created_at: note.created_at, updated_at: note.updated_at,
    }, 201);
  } catch (error) {
    return safeErrorResponse(error, 'Failed to create phase wiki note');
  }
}
