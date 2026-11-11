import { describe, expect, it } from 'vitest';
import {
  WIZARD_STEPS,
  buildWizardRequest,
  detailsProblem,
  startsFromFormat,
  wizardCreatedHref,
  wizardHref,
  wizardStartFromQuery,
  type WizardDetails,
  type WizardExample,
  type WizardFormat,
  type WizardStart,
} from '../wizard';

const LEAGUE_ID = '5e150000-0000-4000-8000-000000000001';
const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const RULESET_ID = '22222222-2222-4222-8222-222222222222';
const FORMAT_ID = '33333333-3333-4333-8333-333333333333';

const example = (over: Partial<WizardExample> = {}): WizardExample => ({
  id: 'cup',
  title: 'Cup',
  summary: null,
  overview: 'One bracket',
  stages: [],
  needsLeagueRuleset: false,
  presetRulesetCount: 0,
  ...over,
});
const EXAMPLES = [example({ id: 'classic-league' }), example({ id: 'cup', needsLeagueRuleset: true })];
const FORMATS: WizardFormat[] = [{ id: FORMAT_ID, name: 'Autumn Cup', version: 3, ownerName: 'Sam', mine: false }];

const details = (over: Partial<WizardDetails> = {}): WizardDetails => ({
  name: 'Spring League',
  description: '',
  formatType: 'singles',
  rulesetId: '',
  startDate: '',
  endDate: '',
  routeTheme: 'auto',
  language: 'de',
  ...over,
});

const BLANK: WizardStart = { kind: 'blank' };
const COPY: WizardStart = { kind: 'copy' };
const PRESET: WizardStart = { kind: 'preset', id: 'cup' };
const FORMAT: WizardStart = { kind: 'format', id: FORMAT_ID };

const request = (over: Partial<Parameters<typeof buildWizardRequest>[0]> = {}) =>
  buildWizardRequest({ start: BLANK, details: details(), formats: FORMATS, clone: null, isSiteAdmin: false, ...over });

describe('WIZARD_STEPS', () => {
  it('runs starting point, details, review', () => {
    expect([...WIZARD_STEPS]).toEqual(['start', 'details', 'review']);
  });
});

describe('wizardHref', () => {
  it('is the plain wizard without a start', () => {
    expect(wizardHref()).toBe('/admin/leagues/new');
  });

  it('names a preset or a format', () => {
    expect(wizardHref({ preset: 'swiss-top-cut' })).toBe('/admin/leagues/new?preset=swiss-top-cut');
    expect(wizardHref({ format: FORMAT_ID })).toBe('/admin/leagues/new?format=' + FORMAT_ID);
  });

  it('encodes what it puts in the query', () => {
    expect(wizardHref({ preset: 'a b&c=d' })).toBe('/admin/leagues/new?preset=a%20b%26c%3Dd');
  });
});

describe('wizardStartFromQuery', () => {
  it('picks a known preset', () => {
    expect(wizardStartFromQuery({ preset: 'cup' }, EXAMPLES, FORMATS)).toEqual({ kind: 'preset', id: 'cup' });
  });

  it('picks a known format', () => {
    expect(wizardStartFromQuery({ format: FORMAT_ID }, EXAMPLES, FORMATS)).toEqual({ kind: 'format', id: FORMAT_ID });
  });

  it('picks nothing for an unknown preset or format', () => {
    expect(wizardStartFromQuery({ preset: 'nope' }, EXAMPLES, FORMATS)).toBeNull();
    expect(wizardStartFromQuery({ format: 'nope' }, EXAMPLES, FORMATS)).toBeNull();
    expect(wizardStartFromQuery({ preset: 'CUP' }, EXAMPLES, FORMATS)).toBeNull();
    expect(wizardStartFromQuery({ preset: '__proto__', format: 'constructor' }, EXAMPLES, FORMATS)).toBeNull();
  });

  it('picks nothing for an empty query or empty lists', () => {
    expect(wizardStartFromQuery({}, EXAMPLES, FORMATS)).toBeNull();
    expect(wizardStartFromQuery({ preset: '', format: '' }, EXAMPLES, FORMATS)).toBeNull();
    expect(wizardStartFromQuery({ preset: 'cup', format: FORMAT_ID }, [], [])).toBeNull();
  });

  it('prefers the preset when both are named, and falls through to the format when the preset is unknown', () => {
    expect(wizardStartFromQuery({ preset: 'cup', format: FORMAT_ID }, EXAMPLES, FORMATS)).toEqual({ kind: 'preset', id: 'cup' });
    expect(wizardStartFromQuery({ preset: 'nope', format: FORMAT_ID }, EXAMPLES, FORMATS)).toEqual({ kind: 'format', id: FORMAT_ID });
  });
});

describe('startsFromFormat', () => {
  it('is true for a preset and a format, false for a blank league and a copy', () => {
    expect(startsFromFormat(PRESET)).toBe(true);
    expect(startsFromFormat(FORMAT)).toBe(true);
    expect(startsFromFormat(BLANK)).toBe(false);
    expect(startsFromFormat(COPY)).toBe(false);
  });
});

describe('buildWizardRequest', () => {
  it('a blank league is the plain create body', () => {
    const body = request({ details: details({ rulesetId: RULESET_ID, startDate: '2027-03-01', description: 'About' }) });

    expect(body).toEqual({
      name: 'Spring League',
      description: 'About',
      format_type: 'singles',
      ruleset_id: RULESET_ID,
      start_date: '2027-03-01',
      end_date: null,
      route_theme: 'auto',
      language: 'de',
    });
    expect(body).not.toHaveProperty('clone_from');
    expect(body).not.toHaveProperty('from_format');
  });

  it('trims the name, and sends unset fields as undefined or null', () => {
    const body = request({ details: details({ name: '  Spring  ' }) });

    expect(body.name).toBe('Spring');
    expect(body.description).toBeUndefined();
    expect(body.ruleset_id).toBeNull();
    expect(body.start_date).toBeNull();
    expect(body.end_date).toBeNull();
  });

  it.each(['singles', 'doubles', 'draft', 'custom'] as const)('a blank %s league sends the picked ruleset', (formatType) => {
    const body = request({ details: details({ formatType, rulesetId: RULESET_ID }) });

    expect(body.format_type).toBe(formatType);
    expect(body.ruleset_id).toBe(RULESET_ID);
  });

  it('a point-buy league never sends a ruleset, even one picked before the switch', () => {
    const body = request({ details: details({ formatType: 'evolution_point_buy', rulesetId: RULESET_ID }) });

    expect(body.format_type).toBe('evolution_point_buy');
    expect(body.ruleset_id).toBeNull();
  });

  it('a blank league ignores a clone choice left over from another start', () => {
    const body = request({ start: BLANK, clone: { sourceId: SOURCE_ID, copyRoster: true, copyAdmins: true }, isSiteAdmin: true });

    expect(body).not.toHaveProperty('clone_from');
  });

  describe('an example start', () => {
    it('is a custom league with from_format.preset_id, whatever the league type field held', () => {
      const body = request({ start: PRESET, details: details({ formatType: 'doubles', rulesetId: RULESET_ID }) });

      expect(body.format_type).toBe('custom');
      expect(body.from_format).toEqual({ preset_id: 'cup' });
      expect(body.ruleset_id).toBe(RULESET_ID);
      expect(body).not.toHaveProperty('clone_from');
    });

    it('keeps the league ruleset even when the league type field held point buy (a custom league has a ruleset)', () => {
      const body = request({ start: PRESET, details: details({ formatType: 'evolution_point_buy', rulesetId: RULESET_ID }) });

      expect(body.format_type).toBe('custom');
      expect(body.ruleset_id).toBe(RULESET_ID);
    });

    it('sends no ruleset when none was picked', () => {
      expect(request({ start: PRESET }).ruleset_id).toBeNull();
    });
  });

  describe('a published format start', () => {
    it('is a custom league that attaches the listed version', () => {
      const body = request({ start: FORMAT });

      expect(body.format_type).toBe('custom');
      expect(body.from_format).toEqual({ definition_id: FORMAT_ID, version_no: 3 });
      expect(body).not.toHaveProperty('clone_from');
    });

    it('names no version when the format is not in the list (the server takes the current one)', () => {
      const body = request({ start: { kind: 'format', id: 'gone' } });

      expect(body.from_format).toEqual({ definition_id: 'gone' });
      expect(body.from_format).not.toHaveProperty('version_no');
    });
  });

  describe('a copy start', () => {
    const clone = { sourceId: SOURCE_ID, copyRoster: true, copyAdmins: true };

    it('carries clone_from, with copy_admins for a site admin', () => {
      const body = request({ start: COPY, clone, isSiteAdmin: true });

      expect(body.clone_from).toEqual({ season_id: SOURCE_ID, copy_roster: true, copy_admins: true });
      expect(body).not.toHaveProperty('from_format');
    });

    it('never sends copy_admins for anyone else, even when the choice carries it', () => {
      const body = request({ start: COPY, clone, isSiteAdmin: false });

      expect(body.clone_from).toEqual({ season_id: SOURCE_ID, copy_roster: true });
      expect(body.clone_from).not.toHaveProperty('copy_admins');
    });

    it('keeps the league type of the details (the source brought it in as a default)', () => {
      const body = request({ start: COPY, clone, details: details({ formatType: 'draft', rulesetId: RULESET_ID }) });

      expect(body.format_type).toBe('draft');
      expect(body.ruleset_id).toBe(RULESET_ID);
    });

    it('without a source it is a plain create body', () => {
      expect(request({ start: COPY, clone: null })).not.toHaveProperty('clone_from');
    });
  });
});

describe('wizardCreatedHref', () => {
  it('opens the overview of a league made from an example or a format, even though it is custom', () => {
    expect(wizardCreatedHref(LEAGUE_ID, PRESET, 'custom')).toBe('/admin/leagues/' + LEAGUE_ID);
    expect(wizardCreatedHref(LEAGUE_ID, FORMAT, 'custom')).toBe('/admin/leagues/' + LEAGUE_ID);
  });

  it('sends the others where a plain create goes', () => {
    expect(wizardCreatedHref(LEAGUE_ID, BLANK, 'singles')).toBe('/admin/leagues/' + LEAGUE_ID);
    expect(wizardCreatedHref(LEAGUE_ID, COPY, 'draft')).toBe('/admin/leagues/' + LEAGUE_ID);
    expect(wizardCreatedHref(LEAGUE_ID, BLANK, 'custom')).toBe('/admin/leagues/' + LEAGUE_ID + '?tab=format');
  });
});

describe('detailsProblem', () => {
  it('is null for complete details', () => {
    expect(detailsProblem(BLANK, details(), null, null)).toBeNull();
    expect(detailsProblem(PRESET, details({ rulesetId: RULESET_ID }), EXAMPLES[1], null)).toBeNull();
    expect(detailsProblem(COPY, details(), null, SOURCE_ID)).toBeNull();
    expect(detailsProblem(FORMAT, details(), null, null)).toBeNull();
  });

  it('refuses an empty or blank name', () => {
    expect(detailsProblem(BLANK, details({ name: '' }), null, null)).toBe('name');
    expect(detailsProblem(BLANK, details({ name: '   ' }), null, null)).toBe('name');
  });

  it('refuses an end date before the start date, and accepts the same day or one date alone', () => {
    expect(detailsProblem(BLANK, details({ startDate: '2027-03-02', endDate: '2027-03-01' }), null, null)).toBe('dates');
    expect(detailsProblem(BLANK, details({ startDate: '2027-03-01', endDate: '2027-03-01' }), null, null)).toBeNull();
    expect(detailsProblem(BLANK, details({ startDate: '2027-03-01' }), null, null)).toBeNull();
    expect(detailsProblem(BLANK, details({ endDate: '2027-03-01' }), null, null)).toBeNull();
  });

  it('wants a ruleset for an example whose stages play under the league ruleset', () => {
    expect(detailsProblem(PRESET, details(), EXAMPLES[1], null)).toBe('ruleset');
  });

  it('does not want one for an example that brings its own, for an unknown example, or for other starts', () => {
    expect(detailsProblem(PRESET, details(), EXAMPLES[0], null)).toBeNull();
    expect(detailsProblem(PRESET, details(), null, null)).toBeNull();
    expect(detailsProblem(FORMAT, details(), EXAMPLES[1], null)).toBeNull();
    expect(detailsProblem(BLANK, details(), EXAMPLES[1], null)).toBeNull();
  });

  it('wants a source for a copy', () => {
    expect(detailsProblem(COPY, details(), null, null)).toBe('source');
    expect(detailsProblem(COPY, details(), null, '')).toBe('source');
  });

  it('reports the name before the dates, the dates before the ruleset, the ruleset before the source', () => {
    const bad = details({ name: '', startDate: '2027-03-02', endDate: '2027-03-01' });
    expect(detailsProblem(PRESET, bad, EXAMPLES[1], null)).toBe('name');
    expect(detailsProblem(PRESET, { ...bad, name: 'x' }, EXAMPLES[1], null)).toBe('dates');
    expect(detailsProblem(PRESET, details(), EXAMPLES[1], SOURCE_ID)).toBe('ruleset');
  });
});
