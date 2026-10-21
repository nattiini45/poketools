import { describe, expect, it } from 'vitest';
import { translateEngineLabel } from '../engine-labels';
import { enumLabel } from '../enum-label';
import { leagueProse } from '../prose';
import { achievementText } from '../achievements';
import { createTranslator } from '../../core';
import { enumMessages } from '../../messages/enums';
import { formatPack } from '@/lib/format-pack';

describe('translateEngineLabel: round names (ported from league-hub copy.ts)', () => {
  const cases: [string, string][] = [
    ['Round 3', 'Runde 3'],
    ['Winners Round 2', 'Gewinnerseite · Runde 2'],
    ['Losers Round 4', 'Verliererseite · Runde 4'],
    ['Winners Final', 'Gewinnerseite · Finale'],
    ['Winners Finals', 'Gewinnerseite · Finale'],
    ['Losers Finals', 'Verliererseite · Finale'],
    ['Grand Finals Reset', 'Großes Finale · Reset'],
    ['Grand Final Reset', 'Großes Finale · Reset'],
    ['Grand Finals', 'Großes Finale'],
    ['Finals', 'Finale'],
    ['Final', 'Finale'],
    ['Semifinals', 'Halbfinale'],
    ['Quarterfinals', 'Viertelfinale'],
  ];
  for (const [stored, german] of cases) {
    it(`${stored} -> ${german}; en is the identity`, () => {
      expect(translateEngineLabel('round', stored, 'de')).toBe(german);
      expect(translateEngineLabel('round', stored, 'en')).toBe(stored);
    });
  }

  it('leaves an admin-written name unchanged', () => {
    expect(translateEngineLabel('round', 'Woche 1', 'de')).toBe('Woche 1');
    expect(translateEngineLabel('round', '', 'de')).toBe('');
  });
});

describe('translateEngineLabel: slots, groups, bracket, notes, actor', () => {
  const cases: [Parameters<typeof translateEngineLabel>[0], string, string][] = [
    ['slot', 'Winner of M3', 'Sieger aus M3'],
    ['slot', 'Loser of M?', 'Verlierer aus M?'],
    ['slot', 'Seed 2 (LB)', 'Setzplatz 2 (Verliererseite)'],
    ['slot', 'Seed 7', 'Setzplatz 7'],
    ['slot', 'BYE', 'Freilos'],
    ['slot', 'Winner of M12 (if necessary)', 'Sieger aus M12 (falls nötig)'],
    ['group', 'Group A', 'Gruppe A'],
    ['bracket', 'Full bracket', 'Gesamter Turnierbaum'],
    ['note', 'Auto-confirmed after timeout.', 'Nach Ablauf der Frist automatisch bestätigt.'],
    ['note', 'Rejected by moderator', 'Von der Moderation abgelehnt'],
    ['note', 'Admin correction', 'Korrektur durch Admin'],
    ['note', 'Rescheduled twice\nAuto-confirmed after timeout.', 'Rescheduled twice\nNach Ablauf der Frist automatisch bestätigt.'],
    ['actor', 'System', 'System'],
  ];
  for (const [kind, stored, german] of cases) {
    it(`${kind}: ${JSON.stringify(stored)}`, () => {
      expect(translateEngineLabel(kind, stored, 'de')).toBe(german);
      expect(translateEngineLabel(kind, stored, 'en')).toBe(stored);
    });
  }
});

describe('enumLabel', () => {
  it('labels known values and falls back to the raw value', () => {
    const tDe = createTranslator(enumMessages, 'de');
    const tEn = createTranslator(enumMessages, 'en');
    expect(enumLabel(tDe, 'matchStatus', 'pending_confirmation')).toBe('Wartet auf Bestätigung');
    expect(enumLabel(tEn, 'matchStatus', 'in_progress')).toBe('In progress');
    // Price-group labels come from the active format pack.
    expect(enumLabel(tDe, 'priceGroup', 'hoch')).toBe(formatPack.messages.de.enums.priceGroup.hoch);
    expect(enumLabel(tEn, 'priceGroup', 'hoch')).toBe(formatPack.messages.en.enums.priceGroup.hoch);
    expect(enumLabel(tDe, 'matchStatus', 'brand_new_status')).toBe('brand_new_status');
    expect(enumLabel(tDe, 'matchStatus', null)).toBe('');
  });
});

describe('leagueProse', () => {
  it('returns the German text with lang="de"', () => {
    expect(leagueProse('  Starker Sweeper  ')).toEqual({ text: 'Starker Sweeper', lang: 'de' });
    expect(leagueProse(null)).toEqual({ text: null, lang: 'de' });
    expect(leagueProse('   ')).toEqual({ text: null, lang: 'de' });
  });
});

describe('achievementText', () => {
  it('falls back to the DB text when the catalog has no entry', () => {
    const def = { key: 'admin_custom', name: 'Custom', description: 'Made by an admin' };
    expect(achievementText(def, 'de')).toEqual({ name: 'Custom', description: 'Made by an admin' });
  });
});
