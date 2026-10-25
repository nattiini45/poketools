import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import AuditLogBrowser, { isValidAuditResourceId } from '../AuditLogBrowser';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('isValidAuditResourceId', () => {
  it('accepts an empty filter and a UUID (surrounding spaces are trimmed)', () => {
    expect(isValidAuditResourceId('')).toBe(true);
    expect(isValidAuditResourceId('   ')).toBe(true);
    expect(isValidAuditResourceId(UUID)).toBe(true);
    expect(isValidAuditResourceId(` ${UUID} `)).toBe(true);
  });

  it('rejects anything that is not a UUID', () => {
    expect(isValidAuditResourceId('abc')).toBe(false);
    expect(isValidAuditResourceId('match-1')).toBe(false);
    expect(isValidAuditResourceId(`${UUID}x`)).toBe(false);
  });
});

describe('AuditLogBrowser', () => {
  it.each(['en', 'de'] as const)('renders the filters in %s and has a UUID-invalid message', (locale) => {
    const html = renderWithI18n(<AuditLogBrowser />, { locale });
    const t = createTranslator(adminToolsMessages, locale);

    expect(html).toContain(t('audit.filters.resourceId'));
    // A blank draft is valid, so no inline error shows initially.
    expect(html).not.toContain(t('audit.filters.resourceIdInvalid'));
    expect(t('audit.filters.resourceIdInvalid')).toContain('UUID');
  });

  it('has real German umlauts in the invalid-UUID message', () => {
    const de = createTranslator(adminToolsMessages, 'de');
    expect(de('audit.filters.resourceIdInvalid')).toContain('gültige');
    expect(de('audit.filters.resourceIdInvalid')).not.toMatch(/Ã|�/);
  });
});
