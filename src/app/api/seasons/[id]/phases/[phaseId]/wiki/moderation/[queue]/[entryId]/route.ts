import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { wikiNotePatchSchema, wikiReportUpdateSchema } from '@/lib/validation';
import { NOTE_MODERATION_STATES } from '@/lib/wiki/note-moderation-state';
import {
  bindScopedPhaseWikiServices, parseWikiInput, phaseWikiResponse, resolveWikiPhase, type WikiPhaseParams,
} from '../../../notes/_lib/route-context';

const expectedUpdatedAt = z.iso.datetime({ offset: true });
const noteVersion = z.object({ expected_state: z.enum(NOTE_MODERATION_STATES), expected_updated_at: expectedUpdatedAt });
const noteActionSchema = z.union([
  noteVersion.extend({ approved: z.literal(true) }).strict(),
  noteVersion.extend({ rejected: z.literal(true), rejection_reason: wikiNotePatchSchema.shape.rejection_reason }).strict(),
  noteVersion.extend({ block_resubmission: z.boolean() }).strict(),
]);
const reportActionSchema = wikiReportUpdateSchema.extend({
  expected_status: wikiReportUpdateSchema.shape.status,
  expected_updated_at: expectedUpdatedAt,
}).strict();
const queueSchema = z.enum(['notes', 'reports']);
type Context = { params: Promise<WikiPhaseParams & { queue: string; entryId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const path = await params;
    const scope = await resolveWikiPhase({
      ...path,
      noteId: path.queue === 'notes' ? path.entryId : undefined,
      reportId: path.queue === 'reports' ? path.entryId : undefined,
    }, 'write', 'admin');
    if (scope instanceof NextResponse) return scope;
    const queue = parseWikiInput(queueSchema, path.queue);
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;

    const services = bindScopedPhaseWikiServices(scope, request);
    const phaseId = scope.owner.phase_id;
    const id = path.entryId.toLowerCase();
    if (queue === 'reports') {
      const { status, expected_status, expected_updated_at } = parseWikiInput(reportActionSchema, body.value);
      await services.closeReport(phaseId, id, status, { status: expected_status, updatedAt: expected_updated_at });
      return phaseWikiResponse({ updated: true });
    }

    const action = parseWikiInput(noteActionSchema, body.value);
    const expected = { state: action.expected_state, updatedAt: action.expected_updated_at };
    if ('block_resubmission' in action) {
      await services.block(phaseId, id, action.block_resubmission, expected);
      return phaseWikiResponse({ updated: true, blocked: action.block_resubmission });
    }
    if ('approved' in action) {
      await services.verdict(phaseId, id, 'approved', expected);
    } else {
      await services.verdict(phaseId, id, 'rejected', expected, action.rejection_reason ?? null);
    }
    return phaseWikiResponse({ updated: true });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update phase wiki moderation entry');
  }
}
