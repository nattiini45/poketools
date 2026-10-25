import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import type { WikiNote, WikiNoteReport } from '@/types/wiki';
import WikiModerationPanel, {
  RejectedNoteCard,
  canAllowResubmission,
  canBlockResubmission,
  canUnpublishReportedNote,
  noteBlockRequest,
  noteRejectRequest,
} from '../WikiModerationPanel';

function reportOn(approved: boolean | undefined): WikiNoteReport {
  return {
    id: 'r1',
    note_id: 'n1',
    reporter_id: 'p2',
    reason: 'spam',
    details: null,
    status: 'open',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    note:
      approved === undefined
        ? undefined
        : { id: 'n1', entity_type: 'pokemon', entity_name: 'Pikachu', content: 'text', author_id: 'p1', approved },
  };
}

describe('canUnpublishReportedNote', () => {
  it('is true only for a report on an approved (public) note', () => {
    expect(canUnpublishReportedNote(reportOn(true))).toBe(true);
    expect(canUnpublishReportedNote(reportOn(false))).toBe(false);
    expect(canUnpublishReportedNote(reportOn(undefined))).toBe(false);
  });
});

describe('noteRejectRequest', () => {
  it('PATCHes the note with a bare rejection when no reason is given', () => {
    const { url, init } = noteRejectRequest('n1');
    expect(url).toBe('/api/wiki/notes/n1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ rejected: true });
  });

  it('sends the trimmed reason and omits a blank one', () => {
    expect(JSON.parse(noteRejectRequest('n1', '  spam ').init.body as string)).toEqual({
      rejected: true,
      rejection_reason: 'spam',
    });
    expect(JSON.parse(noteRejectRequest('n1', '   ').init.body as string)).toEqual({ rejected: true });
  });
});

function rejectedNote(overrides: Partial<WikiNote> = {}): WikiNote {
  return {
    id: 'n1',
    entity_type: 'pokemon',
    entity_name: 'Pikachu',
    author_id: 'p1',
    author_name: 'Ash',
    content: 'A rejected note',
    scope_type: 'global',
    scope_id: null,
    approved: false,
    rejected_at: '2026-01-02T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

const NOOP = () => undefined;
function renderCard(note: WikiNote, isSuperadmin: boolean, locale: Locale = 'en'): string {
  return renderWithI18n(
    <RejectedNoteCard note={note} isSuperadmin={isSuperadmin} onApprove={NOOP} onDelete={NOOP} onBlock={NOOP} onAllow={NOOP} />,
    { locale },
  );
}

describe('noteBlockRequest', () => {
  it('PATCHes the note with the strict block_resubmission body', () => {
    const block = noteBlockRequest('n1', true);
    expect(block.url).toBe('/api/wiki/notes/n1');
    expect(block.init.method).toBe('PATCH');
    expect(JSON.parse(block.init.body as string)).toEqual({ block_resubmission: true });
    expect(JSON.parse(noteBlockRequest('n1', false).init.body as string)).toEqual({ block_resubmission: false });
  });
});

describe('block / allow resubmitting availability', () => {
  it('offers the block only to the superadmin, only on a rejected note that is not blocked yet', () => {
    expect(canBlockResubmission(rejectedNote(), true)).toBe(true);
    expect(canBlockResubmission(rejectedNote(), false)).toBe(false);
    expect(canBlockResubmission(rejectedNote({ rejected_at: null }), true)).toBe(false);
    expect(canBlockResubmission(rejectedNote({ approved: true }), true)).toBe(false);
    expect(canBlockResubmission(rejectedNote({ resubmission_blocked_at: '2026-01-03T00:00:00.000Z' }), true)).toBe(false);
  });

  it('offers the undo only to the superadmin, only on a blocked note', () => {
    const blocked = rejectedNote({ resubmission_blocked_at: '2026-01-03T00:00:00.000Z' });
    expect(canAllowResubmission(blocked, true)).toBe(true);
    expect(canAllowResubmission(blocked, false)).toBe(false);
    expect(canAllowResubmission(rejectedNote(), true)).toBe(false);
  });
});

describe('RejectedNoteCard markup', () => {
  const blocked = rejectedNote({ resubmission_blocked_at: '2026-01-03T00:00:00.000Z' });

  it('shows the superadmin a Block button on a rejected note, with no badge', () => {
    const html = renderCard(rejectedNote(), true);
    expect(html).toContain('Block from resubmitting');
    expect(html).not.toContain('Allow resubmitting');
    expect(html).not.toContain('Blocked');
  });

  it('shows a site admin who is not the superadmin neither button', () => {
    const html = renderCard(rejectedNote(), false);
    expect(html).not.toContain('Block from resubmitting');
    expect(html).not.toContain('Allow resubmitting');
    expect(html).toContain('Approve');
  });

  it('shows a Blocked badge to everyone and the undo only to the superadmin', () => {
    const asSuperadmin = renderCard(blocked, true);
    expect(asSuperadmin).toContain('Blocked');
    expect(asSuperadmin).toContain('Allow resubmitting');
    expect(asSuperadmin).not.toContain('Block from resubmitting');

    const asAdmin = renderCard(blocked, false);
    expect(asAdmin).toContain('Blocked');
    expect(asAdmin).not.toContain('Allow resubmitting');
  });

  it('is translated to German', () => {
    const html = renderCard(blocked, true, 'de');
    expect(html).toContain('Gesperrt');
    expect(html).toContain('Erneutes Einreichen erlauben');
    expect(renderCard(rejectedNote(), true, 'de')).toContain('Erneutes Einreichen sperren');
  });
});

describe('block confirmation dialog texts', () => {
  it.each(['en', 'de'] as const)('says the block is final for the author in %s', (locale: Locale) => {
    const t = createTranslator(adminToolsMessages, locale);
    for (const key of ['wiki.blockDialog.title', 'wiki.blockDialog.message', 'wiki.blockDialog.confirm', 'wiki.blockResubmission', 'wiki.allowResubmission', 'wiki.blocked'] as const) {
      expect(t(key).length).toBeGreaterThan(0);
      expect(t(key)).not.toBe(key);
    }
  });

  it('spells out that it is final (EN) and uses real umlauts (DE)', () => {
    expect(createTranslator(adminToolsMessages, 'en')('wiki.blockDialog.message')).toContain('final for the author');
    const de = createTranslator(adminToolsMessages, 'de');
    expect(de('wiki.blockDialog.message')).toContain('endgültig');
    expect(de('wiki.blockDialog.message')).toContain('Prüfung');
  });
});

describe('WikiModerationPanel', () => {
  it('renders its initial state in both languages', () => {
    expect(renderWithI18n(<WikiModerationPanel />, { locale: 'en' })).toContain('Pending Notes');
    expect(renderWithI18n(<WikiModerationPanel />, { locale: 'de' })).toContain('Offene Notizen');
  });

  it('offers the pending and rejected views, where the rejected notes are found', () => {
    const html = renderWithI18n(<WikiModerationPanel isSuperadmin />, { locale: 'en' });
    expect(html).toContain('Pending');
    expect(html).toContain('Rejected');
  });
});

describe('admin-tools keys for the wiki unpublish, export summary and audit filter', () => {
  const keys = [
    'wiki.unpublish',
    'wiki.noteLive',
    'wiki.noteHidden',
    'data.export.summary',
    'data.export.summaryLimited',
    'data.export.summaryMaxed',
    'audit.filters.resourceIdInvalid',
  ] as const;
  const MOJIBAKE = /[\u00c3\u00c2\ufffd]|\u00e2\u20ac/;

  it.each(['en', 'de'] as const)('resolves every key in %s', (locale: Locale) => {
    const t = createTranslator(adminToolsMessages, locale);
    for (const key of keys) {
      const text = t(key, { count: 5, total: 12 });
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe(key);
      expect(text).not.toMatch(MOJIBAKE);
    }
    expect(t('data.export.summary', { count: 5, total: 12 })).toContain('5');
    expect(t('data.export.summary', { count: 5, total: 12 })).toContain('12');
  });

  it('uses real umlauts in the German strings', () => {
    const de = createTranslator(adminToolsMessages, 'de');
    expect(de('wiki.unpublish')).toBe('Notiz zurückziehen');
    expect(de('wiki.noteLive')).toBe('Diese Notiz ist öffentlich');
    expect(de('data.export.summaryLimited', { count: 1, total: 2 })).toContain('erhöhe');
  });
});
