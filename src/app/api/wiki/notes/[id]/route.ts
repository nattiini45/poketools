import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { wikiNotePatchSchema, formatZodErrors } from '@/lib/validation';
import { getNoteById, updateNote, deleteNote, approveNote, rejectNote } from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_NOTE_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json();
    const zodResult = wikiNotePatchSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const body = zodResult.data;

    if (body.approved === true && body.rejected === true) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'A note cannot be approved and rejected in the same request',
          code: 'wiki_note_approve_reject_conflict',
        },
        { status: 400 },
      );
    }

    // Approving a note requires admin
    if (body.approved === true) {
      const admin = await requireAdmin();
      const note = await getNoteById(id);
      if (!note) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Note not found', code: 'wiki_note_not_found' },
          { status: 404 },
        );
      }
      await approveNote(id, admin.playerId);
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'wiki.note.approve',
        resource_type: 'wiki_note',
        resource_id: id,
        resource_name: `${note.entity_type}:${note.entity_name}`,
      });
      return NextResponse.json<ApiResult<{ updated: true }>>(
        { success: true, data: { updated: true } },
      );
    }

    if (body.rejected === true) {
      const admin = await requireAdmin();
      const note = await getNoteById(id);
      if (!note) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Note not found', code: 'wiki_note_not_found' },
          { status: 404 },
        );
      }
      // No reason given is stored as null (never an English default); a UI showing
      // the reason labels null in the viewer's language.
      const reason = body.rejection_reason ?? null;
      await rejectNote(id, admin.playerId, reason);
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'wiki.note.reject',
        resource_type: 'wiki_note',
        resource_id: id,
        resource_name: `${note.entity_type}:${note.entity_name}`,
        metadata: { reason, was_approved: note.approved },
      });
      return NextResponse.json<ApiResult<{ updated: true }>>(
        { success: true, data: { updated: true } },
      );
    }

    // Updating content requires being the author
    const player = await requirePlayer();
    const note = await getNoteById(id);
    if (!note) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Note not found', code: 'wiki_note_not_found' },
        { status: 404 },
      );
    }

    if (note.author_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized to edit this note', code: 'wiki_note_edit_forbidden' },
        { status: 403 },
      );
    }

    if (!body.content) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'content is required', code: 'wiki_note_content_required' },
        { status: 400 },
      );
    }

    // An author's edit puts the note back in the pending queue; a site admin's edit keeps its status.
    const editor = player.isAdmin ? 'moderator' : 'author';
    await updateNote(id, body.content, editor);
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'wiki.note.update',
      resource_type: 'wiki_note',
      resource_id: id,
      resource_name: `${note.entity_type}:${note.entity_name}`,
      metadata: { requeued: editor === 'author', was_approved: note.approved },
    });
    return NextResponse.json<ApiResult<{ updated: true; requeued: boolean }>>(
      { success: true, data: { updated: true, requeued: editor === 'author' } },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update note');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const player = await requirePlayer();
    const invalidId = rejectInvalidPathId(id, 'INVALID_NOTE_ID');
    if (invalidId) return invalidId;

    const note = await getNoteById(id);
    if (!note) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Note not found', code: 'wiki_note_not_found' },
        { status: 404 },
      );
    }

    if (note.author_id !== player.playerId && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Not authorized to delete this note', code: 'wiki_note_delete_forbidden' },
        { status: 403 },
      );
    }

    await deleteNote(id);
    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'wiki.note.delete',
      resource_type: 'wiki_note',
      resource_id: id,
      resource_name: `${note.entity_type}:${note.entity_name}`,
      metadata: { author_id: note.author_id },
    });
    return NextResponse.json<ApiResult<{ deleted: true }>>(
      { success: true, data: { deleted: true } },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete note');
  }
}
