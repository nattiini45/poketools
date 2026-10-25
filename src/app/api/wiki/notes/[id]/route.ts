import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer, requireAdmin, getSession, isSuperadmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { wikiNotePatchSchema, wikiNoteBlockResubmissionSchema, formatZodErrors } from '@/lib/validation';
import {
  getNoteById,
  updateNote,
  deleteNote,
  approveNote,
  rejectNote,
  setNoteResubmissionBlock,
} from '@/lib/supabase/queries/wiki-notes';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

function resubmissionBlockedResponse() {
  return NextResponse.json<ApiResult<never>>(
    {
      success: false,
      error: 'A moderator closed this note for resubmission',
      code: 'wiki_note_resubmission_blocked',
    },
    { status: 403 },
  );
}

function blockNotRejectedResponse() {
  return NextResponse.json<ApiResult<never>>(
    {
      success: false,
      error: 'Only a rejected note can be blocked from resubmitting',
      code: 'wiki_note_block_not_rejected',
    },
    { status: 409 },
  );
}

/**
 * Superadmin only: closes a rejected note for resubmission (`block_resubmission: true`) or reopens it (`false`).
 * Blocking keeps the note rejected; it is refused (409) for a note that is not rejected. Site admins who are not the
 * superadmin get 403. Repeating the current state is a no-op (nothing written, nothing audited).
 */
async function handleResubmissionBlock(id: string, rawBody: unknown) {
  const zodResult = wikiNoteBlockResubmissionSchema.safeParse(rawBody);
  if (!zodResult.success) {
    const issues = formatZodErrors(zodResult.error);
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: issues, code: 'validation_failed', params: { issues } },
      { status: 400 },
    );
  }
  const { block_resubmission: block } = zodResult.data;

  const admin = await requireAdmin();
  if (!isSuperadmin(await getSession())) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'Only the superadmin can block a note from resubmitting',
        code: 'wiki_note_block_superadmin_only',
      },
      { status: 403 },
    );
  }

  const note = await getNoteById(id);
  if (!note) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Note not found', code: 'wiki_note_not_found' },
      { status: 404 },
    );
  }

  if (Boolean(note.resubmission_blocked_at) === block) {
    return NextResponse.json<ApiResult<{ updated: true; blocked: boolean }>>(
      { success: true, data: { updated: true, blocked: block } },
    );
  }
  if (block && (note.approved || !note.rejected_at)) return blockNotRejectedResponse();

  // The write filters on "rejected" itself: a note approved or re-queued since the read is not blocked.
  const changed = await setNoteResubmissionBlock(id, block, admin.playerId);
  if (!changed) return blockNotRejectedResponse();

  logAuditEvent({
    actor_id: admin.playerId,
    actor_name: admin.name,
    action: block ? 'wiki.note.block_resubmission' : 'wiki.note.unblock_resubmission',
    resource_type: 'wiki_note',
    resource_id: id,
    resource_name: `${note.entity_type}:${note.entity_name}`,
    metadata: { author_id: note.author_id },
  });
  return NextResponse.json<ApiResult<{ updated: true; blocked: boolean }>>(
    { success: true, data: { updated: true, blocked: block } },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_NOTE_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json();

    // The superadmin's block / unblock request is its own strict body, never mixed with an edit or a verdict.
    if (typeof rawBody === 'object' && rawBody !== null && 'block_resubmission' in rawBody) {
      return await handleResubmissionBlock(id, rawBody);
    }

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

    // A note the superadmin closed for resubmission stays rejected: the author's edit is refused and re-queues nothing.
    if (editor === 'author' && note.resubmission_blocked_at) {
      return resubmissionBlockedResponse();
    }

    const applied = await updateNote(id, body.content, editor);
    if (!applied) {
      // The UPDATE touched no row: the note was blocked (or deleted) after the checks above.
      const current = await getNoteById(id);
      if (!current) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Note not found', code: 'wiki_note_not_found' },
          { status: 404 },
        );
      }
      return resubmissionBlockedResponse();
    }
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
