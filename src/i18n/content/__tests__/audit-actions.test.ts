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

  it("uses a pack extension's own label for its extension.* actions, and only for those", () => {
    const labels = { 'extension.archive.cache.refresh': 'Archiv-Zwischenspeicher erneuert', 'player.role.assign': 'hijacked' };
    expect(auditActionLabel(de, 'extension.archive.cache.refresh', labels)).toBe('Archiv-Zwischenspeicher erneuert');
    // A built-in action keeps the catalog label even if the map names it.
    expect(auditActionLabel(de, 'player.role.assign', labels)).toBe('Rolle vergeben');
    // An extension action without a label is humanized, as before.
    expect(auditActionLabel(en, 'extension.archive.person.link', labels)).toBe('extension archive person link');
    // Inherited object keys are not labels.
    expect(auditActionLabel(en, 'extension.toString', labels)).toBe('extension toString');
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
