/** auditActionLabel lives in a plain (non-client) module so server code can share it (T08/T09). */
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/core';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { auditActionLabel } from '../audit-actions';

const en = createTranslator(adminCoreMessages, 'en');
const de = createTranslator(adminCoreMessages, 'de');

describe('auditActionLabel (i18n/content)', () => {
  it('reads the auditActions catalog in the viewer language', () => {
    expect(auditActionLabel(en, 'player.role.assign')).toBe('Role assigned');
    expect(auditActionLabel(de, 'player.role.assign')).toBe('Rolle vergeben');
  });

  it('humanizes unknown or unsafe actions', () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(auditActionLabel(en, 'legacy.some_action')).toBe('legacy some action');
      expect(auditActionLabel(en, 'bad-action.x')).toBe('bad-action x');
    } finally {
      console.warn = warn;
    }
  });
});
