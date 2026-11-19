import { z } from 'zod';
import type { PhaseWikiActor, PhaseWikiNote, PhaseWikiNoteChanges, PhaseWikiNoteInput } from '@/types/phase-wiki';
import type { PhaseWikiStorage } from '@/lib/supabase/queries/phase-wiki-notes';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { wikiNoteCreateSchema, wikiNoteReportSchema, FIELD_LIMITS } from '@/lib/validation/schemas';
import { scanWikiNoteContent } from './moderation';
import { noteModerationMachine, noteModerationState, type NoteModerationState } from './note-moderation-state';
import { noteReportMachine } from './note-report-state';
import { phaseWikiReportReceipt, toPublicPhaseWikiNote } from './phase-public';
import type { WikiEntityType, WikiNoteReportStatus } from '@/types/wiki';
import type { AuditAction, AuditLogEntry } from '@/lib/audit/log';

export const phaseWikiNoteCreateSchema = wikiNoteCreateSchema.pick({ entity_type: true, entity_name: true, content: true }).strict();
const contentInput = phaseWikiNoteCreateSchema.shape.content;
const reasonInput = z.string().trim().min(1).max(FIELD_LIMITS.DESCRIPTION).nullable();

interface PhaseWikiCommit {
  action: Extract<AuditAction, `wiki.${string}`>;
  resource: Pick<AuditLogEntry, 'resource_type' | 'resource_id' | 'resource_name'>;
  metadata: Record<string, unknown>;
}

export interface PhaseWikiDependencies {
  storage: PhaseWikiStorage;
  requireActor(phaseId: string): Promise<PhaseWikiActor>;
  assertPublicPhase(phaseId: string): Promise<void>;
  invalidate(phaseId: string): Promise<void>;
  auditCommit?(event: PhaseWikiCommit): void;
}

export interface PhaseWikiVersion {
  state: NoteModerationState;
  updatedAt: string;
}

function noteResource(row: PhaseWikiNote) {
  return { resource_type: 'wiki_note', resource_id: row.id, resource_name: `${row.entity_type}:${row.entity_name}` };
}

function assertNoteVersion(row: PhaseWikiNote, current: NoteModerationState, expected: Partial<PhaseWikiVersion>) {
  if ((expected.state !== undefined && expected.state !== current)
    || (expected.updatedAt !== undefined && expected.updatedAt !== row.updated_at)) {
    failure('wiki_note_changed', 'This note changed after you loaded it. Reload and review it again.', 409);
  }
}

function failure(code: 'wiki_note_not_found' | 'wiki_note_changed' | 'wiki_report_not_found' | 'wiki_report_changed' |
  'wiki_note_edit_forbidden' | 'wiki_note_delete_forbidden' | 'wiki_note_block_superadmin_only' |
  'wiki_note_resubmission_blocked' | 'wiki_note_block_not_rejected', message: string, status: number): never {
  throw new UserFacingError(message, { code, status });
}

function siteAdmin(actor: PhaseWikiActor) {
  if (!actor.isSiteAdmin) throw new UserFacingError('You do not have permission to do this.', { code: 'forbidden', status: 403 });
}

export function createPhaseWikiServices(deps: PhaseWikiDependencies) {
  const { storage } = deps;
  async function note(phaseId: string, id: string) {
    z.uuid().parse(phaseId);
    z.uuid().parse(id);
    const row = await storage.getNote(phaseId, id);
    if (!row) failure('wiki_note_not_found', 'Note not found', 404);
    return row;
  }
  async function write(row: PhaseWikiNote, fields: PhaseWikiNoteChanges, remove = false) {
    if (!(await storage.writeNote(row, fields, remove))) {
      if (!(await storage.getNote(row.phase_id, row.id))) failure('wiki_note_not_found', 'Note not found', 404);
      failure('wiki_note_changed', 'This note changed after you loaded it. Reload and review it again.', 409);
    }
    await deps.invalidate(row.phase_id);
  }
  return {
    async approved(phaseId: string, entity: { type: WikiEntityType; name: string }) {
      z.uuid().parse(phaseId);
      await deps.assertPublicPhase(phaseId);
      const rows = await storage.listNotes(phaseId, true, entity);
      return rows.flatMap((row) => { const publicNote = toPublicPhaseWikiNote(row); return publicNote ? [publicNote] : []; });
    },
    async moderationQueue(phaseId: string, filters?: Parameters<PhaseWikiStorage['listNotes']>[3]) {
      z.uuid().parse(phaseId);
      siteAdmin(await deps.requireActor(phaseId));
      return filters ? storage.listNotes(phaseId, false, undefined, filters) : storage.listNotes(phaseId, false);
    },
    async reports(phaseId: string, filters?: Parameters<PhaseWikiStorage['listReports']>[1]) {
      z.uuid().parse(phaseId);
      siteAdmin(await deps.requireActor(phaseId));
      return filters ? storage.listReports(phaseId, filters) : storage.listReports(phaseId);
    },
    async create(phaseId: string, input: PhaseWikiNoteInput) {
      z.uuid().parse(phaseId);
      const actor = await deps.requireActor(phaseId);
      const parsed = phaseWikiNoteCreateSchema.parse(input);
      const row = await storage.createNote(phaseId, actor.playerId, parsed, scanWikiNoteContent(parsed.content));
      await deps.invalidate(phaseId);
      deps.auditCommit?.({
        action: 'wiki.note.create',
        resource: noteResource(row),
        metadata: { entity_type: row.entity_type, entity_name: row.entity_name, moderation_flags: row.moderation_flags },
      });
      return row;
    },
    async edit(phaseId: string, id: string, content: string) {
      const actor = await deps.requireActor(phaseId);
      const row = await note(phaseId, id);
      if (!actor.isSiteAdmin && row.author_id !== actor.playerId) failure('wiki_note_edit_forbidden', 'Not authorized to edit this note', 403);
      const fields: PhaseWikiNoteChanges = { content: contentInput.parse(content), moderation_flags: scanWikiNoteContent(content) };
      if (!actor.isSiteAdmin) {
        if (noteModerationState(row) === 'blocked') failure('wiki_note_resubmission_blocked', 'A moderator closed this note for resubmission', 403);
        noteModerationMachine.assertTransition(noteModerationState(row), 'pending', 'author');
        Object.assign(fields, { approved: false, approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, rejection_reason: null });
      }
      await write(row, fields);
      const requeued = !actor.isSiteAdmin;
      deps.auditCommit?.({ action: 'wiki.note.update', resource: noteResource(row), metadata: { requeued, was_approved: row.approved } });
      return { requeued };
    },
    async remove(phaseId: string, id: string) {
      const actor = await deps.requireActor(phaseId);
      const row = await note(phaseId, id);
      if (!actor.isSiteAdmin && row.author_id !== actor.playerId) failure('wiki_note_delete_forbidden', 'Not authorized to delete this note', 403);
      await write(row, {}, true);
      deps.auditCommit?.({ action: 'wiki.note.delete', resource: noteResource(row), metadata: { author_id: row.author_id } });
    },
    async verdict(phaseId: string, id: string, target: 'approved' | 'rejected', expected: Partial<PhaseWikiVersion>, reason: string | null = null) {
      const actor = await deps.requireActor(phaseId);
      siteAdmin(actor);
      const row = await note(phaseId, id);
      const current = noteModerationState(row);
      assertNoteVersion(row, current, expected);
      noteModerationMachine.assertTransition(current, target, 'admin');
      const now = new Date().toISOString();
      await write(row, target === 'approved' ? {
        approved: true, approved_by: actor.playerId, approved_at: now, rejected_by: null, rejected_at: null,
        rejection_reason: null, resubmission_blocked_at: null, resubmission_blocked_by: null,
      } : { approved: false, rejected_by: actor.playerId, rejected_at: now, rejection_reason: reasonInput.parse(reason) });
      deps.auditCommit?.({
        action: target === 'approved' ? 'wiki.note.approve' : 'wiki.note.reject',
        resource: noteResource(row),
        metadata: target === 'rejected' ? { reason, was_approved: row.approved } : {},
      });
    },
    async block(phaseId: string, id: string, blocked: boolean, expected?: PhaseWikiVersion) {
      const actor = await deps.requireActor(phaseId);
      siteAdmin(actor);
      if (!actor.isSuperadmin) failure('wiki_note_block_superadmin_only', 'Only the superadmin can block a note from resubmitting', 403);
      const row = await note(phaseId, id);
      const current = noteModerationState(row);
      if (expected) assertNoteVersion(row, current, expected);
      if (Boolean(row.resubmission_blocked_at) === blocked) return;
      if (blocked && current !== 'rejected') failure('wiki_note_block_not_rejected', 'Only a rejected note can be blocked from resubmitting', 409);
      noteModerationMachine.assertTransition(current, blocked ? 'blocked' : 'rejected', 'superadmin');
      await write(row, { resubmission_blocked_at: blocked ? new Date().toISOString() : null, resubmission_blocked_by: blocked ? actor.playerId : null });
      deps.auditCommit?.({
        action: blocked ? 'wiki.note.block_resubmission' : 'wiki.note.unblock_resubmission',
        resource: noteResource(row),
        metadata: { author_id: row.author_id },
      });
    },
    async report(phaseId: string, id: string, input: { reason: string; details?: string }) {
      const actor = await deps.requireActor(phaseId);
      const parsed = wikiNoteReportSchema.strict().parse(input);
      const row = await note(phaseId, id);
      if (!toPublicPhaseWikiNote(row)) failure('wiki_note_not_found', 'Note not found', 404);
      const previous = await storage.findReport(id, actor.playerId);
      if (previous) {
        if (!noteReportMachine.isState(previous.status)) throw new Error('phase_wiki_report_invalid_status');
        noteReportMachine.assertTransition(previous.status, 'open', 'reporter');
      }
      const report = await storage.submitReport(row, actor.playerId, parsed.reason, parsed.details ?? null, previous);
      await deps.invalidate(phaseId);
      deps.auditCommit?.({ action: 'wiki.note.report', resource: noteResource(row), metadata: { reason: report.reason } });
      return phaseWikiReportReceipt(report);
    },
    async closeReport(phaseId: string, id: string, status: WikiNoteReportStatus, expected?: { status: WikiNoteReportStatus; updatedAt: string }) {
      z.uuid().parse(phaseId);
      z.uuid().parse(id);
      siteAdmin(await deps.requireActor(phaseId));
      const report = await storage.getReport(phaseId, id);
      if (!report) failure('wiki_report_not_found', 'Report not found', 404);
      if (!noteReportMachine.isState(report.status)) throw new Error('phase_wiki_report_invalid_status');
      if (expected && (expected.status !== report.status || expected.updatedAt !== report.updated_at)) {
        failure('wiki_report_changed', 'Another moderator already closed this report. Reload to see its current status.', 409);
      }
      noteReportMachine.assertTransition(report.status, status, 'admin');
      if (!(await storage.closeReport(report, status))) {
        if (!(await storage.getReport(phaseId, id))) failure('wiki_report_not_found', 'Report not found', 404);
        failure('wiki_report_changed', 'Another moderator already closed this report. Reload to see its current status.', 409);
      }
      await deps.invalidate(phaseId);
      deps.auditCommit?.({
        action: 'wiki.report.update',
        resource: { resource_type: 'wiki_note_report', resource_id: id },
        metadata: { status, note_id: report.note_id },
      });
    },
  };
}
