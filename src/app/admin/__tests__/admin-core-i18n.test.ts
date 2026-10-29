/**
 * T08 (i18n-core §11.3): the audit-action humanizer of the admin dashboard
 * became an `admin-core.auditActions` key map with a raw fallback.
 */
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/core';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { auditActionLabel } from '../AdminDashboardContent';

const en = createTranslator(adminCoreMessages, 'en');
const de = createTranslator(adminCoreMessages, 'de');

describe('auditActionLabel', () => {
  it('maps dotted audit actions to their labels in both languages', () => {
    expect(auditActionLabel(en, 'player.role.assign')).toBe('Role assigned');
    expect(auditActionLabel(de, 'player.role.assign')).toBe('Rolle vergeben');
    expect(auditActionLabel(en, 'season.phase.groups.repair')).toBe('Phase groups repaired');
    expect(auditActionLabel(de, 'match.auto_confirm')).toBe('Spiel automatisch bestätigt');
  });

  it('labels the Admin Assistant actions and the league creation in both languages', () => {
    const agentActions = [
      'agent.propose',
      'agent.approve',
      'agent.decline',
      'agent.expire',
      'agent.step.execute',
      'agent.step.fail',
      'agent.step.unknown',
      'agent.draft.write',
      'agent.budget.block',
      'season.create',
    ];
    for (const action of agentActions) {
      // A label, not the humanized raw action the fallback would return.
      const humanized = action.replace(/\./g, ' ').replace(/_/g, ' ');
      expect(auditActionLabel(en, action)).not.toBe(humanized);
      expect(auditActionLabel(de, action)).not.toBe(humanized);
    }
    expect(auditActionLabel(en, 'agent.step.fail')).toBe('Assistant step failed');
    expect(auditActionLabel(de, 'agent.step.fail')).toBe('Schritt des Assistenten fehlgeschlagen');
    expect(auditActionLabel(de, 'season.create')).toBe('Liga angelegt');
  });

  it('falls back to the humanized raw action for unknown or odd values', () => {
    expect(auditActionLabel(de, 'draft.pick_admin_override')).toBe('draft pick admin override');
    expect(auditActionLabel(en, 'player')).toBe('player');
    expect(auditActionLabel(en, 'weird action!')).toBe('weird action!');
  });

  it('covers the same keys in English and German', () => {
    expect(Object.keys(adminCoreMessages.de.auditActions).sort()).toEqual(
      Object.keys(adminCoreMessages.en.auditActions).sort(),
    );
  });
});
