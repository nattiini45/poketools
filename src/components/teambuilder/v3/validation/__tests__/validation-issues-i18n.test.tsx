/**
 * Validation issues render by `code` through `teambuilder.validation.issue.*`, with @pkmn params localized
 * through the pkmn layer; issues without a code keep the API's English text (sweep S5).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import type { TeamValidationResult } from '@/types/team';
import ValidationPanel from '../ValidationPanel';
import LegalityBadge from '../../../LegalityBadge';
import { jumpSectionFor } from '../../workspace/SetWorkspace';
import { createTranslator } from '@/i18n/core';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

const coded: TeamValidationResult = {
  valid: false,
  issues: [
    {
      pokemon_index: 0,
      species: 'Charizard',
      issue: "Tera type Water must match one of Charizard's types (Fire / Flying)",
      severity: 'error',
      code: 'tera_type_mismatch',
      params: { type: 'Water', species: 'Charizard', types: 'Fire/Flying' },
    },
    {
      pokemon_index: 0,
      species: 'Charizard',
      issue: 'Legacy text without a code',
      severity: 'warning',
    },
  ],
  team_issues: ['Pikachu is not in your draft roster'],
  team_issue_details: [
    { issue: 'Pikachu is not in your draft roster', code: 'not_in_roster', params: { species: 'Pikachu' } },
  ],
};

describe('ValidationPanel issue texts', () => {
  it('renders the English catalog text in English', () => {
    const en = renderToStaticMarkup(<ValidationPanel validation={coded} />);
    expect(en).toContain('Tera type Water must match one of Charizard&#x27;s types (Fire / Flying)');
    expect(en).toContain('Pikachu is not in your draft roster');
  });

  it('translates coded issues and localizes their names in German', () => {
    const de = renderWithI18n(<ValidationPanel validation={coded} />, { locale: 'de' });
    expect(de).toContain('Tera-Typ Wasser muss einem Typ von Glurak entsprechen (Feuer / Flug)');
    expect(de).toContain('Pikachu ist nicht in deinem Draft-Kader');
    // No code: the English API text, marked as English
    expect(de).toContain('<span lang="en">Legacy text without a code</span>');
  });

  it('falls back to the plain team_issues when the details are missing', () => {
    const legacy: TeamValidationResult = { valid: false, issues: [], team_issues: ['Some old team issue'] };
    const de = renderWithI18n(<ValidationPanel validation={legacy} />, { locale: 'de' });
    expect(de).toContain('Some old team issue');
  });
});

describe('LegalityBadge issue texts', () => {
  it('translates team and set issues in German', () => {
    const de = renderWithI18n(<LegalityBadge validation={coded} />, { locale: 'de' });
    expect(de).toContain('Pikachu ist nicht in deinem Draft-Kader');
    expect(de).toContain('Tera-Typ Wasser muss einem Typ von Glurak entsprechen (Feuer / Flug)');
  });
});

describe('SetWorkspace jump sections', () => {
  it('maps issue codes to editor sections', () => {
    expect(jumpSectionFor('unknown_move')).toBe('moves');
    expect(jumpSectionFor('min_moves')).toBe('moves');
    expect(jumpSectionFor('item_banned')).toBe('fields');
    expect(jumpSectionFor('unknown_ability')).toBe('fields');
    expect(jumpSectionFor('ev_stat_cap')).toBe('stats');
    // The codes of the shared team check.
    expect(jumpSectionFor('ev_stat_invalid')).toBe('stats');
    expect(jumpSectionFor('iv_range')).toBe('stats');
    expect(jumpSectionFor('move_illegal')).toBe('moves');
    expect(jumpSectionFor('duplicate_move')).toBe('moves');
    expect(jumpSectionFor('ability_illegal')).toBe('fields');
    // Codes with no field to jump to stay on the species header.
    expect(jumpSectionFor('level_range')).toBe('header');
    expect(jumpSectionFor('malformed_set')).toBe('header');
    expect(jumpSectionFor('species_banned')).toBe('header');
    expect(jumpSectionFor(undefined)).toBe('header');
  });
});

describe('speed solver notes', () => {
  it('has both notes in English and German with the item param', () => {
    const en = createTranslator(teambuilderMessages, 'en');
    const de = createTranslator(teambuilderMessages, 'de');
    expect(en('speed.impossibleTryScarf', { item: 'Choice Scarf' })).toBe(
      'Not possible. Consider Choice Scarf or a speed-boosting ability.',
    );
    expect(en('speed.impossibleEvenScarf', { item: 'Choice Scarf' })).toBe(
      'Not possible even with Choice Scarf at max investment.',
    );
    expect(de('speed.impossibleEvenScarf', { item: 'Wahlschal' })).toContain('Wahlschal');
  });
});
