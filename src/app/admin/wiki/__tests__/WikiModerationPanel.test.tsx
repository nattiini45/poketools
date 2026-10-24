import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import type { WikiNoteReport } from '@/types/wiki';
import WikiModerationPanel, { canUnpublishReportedNote, noteRejectRequest } from '../WikiModerationPanel';

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

describe('WikiModerationPanel', () => {
  it('renders its initial state in both languages', () => {
    expect(renderWithI18n(<WikiModerationPanel />, { locale: 'en' })).toContain('Pending Notes');
    expect(renderWithI18n(<WikiModerationPanel />, { locale: 'de' })).toContain('Offene Notizen');
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
