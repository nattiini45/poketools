import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n';
import { apiErrorText, toApiErrorLike, type ApiErrorLike } from '../api-errors';
import { errorsAi, errorsDraft, errorsMatches, errorsSeasons, errorsTournaments } from '../messages/errors';
import type { PkmnParamLocalizer } from '../pkmn-seam';
import { useApiErrorText, useApiErrorTextWithPkmn } from '../use-api-error';

/** API error rendering (i18n-core §4.2; owner G0-ERR). */

const fakeGerman: PkmnParamLocalizer = (kind, name) => (kind === 'species' && name === 'Charmander' ? 'Glumanda' : name);

describe('toApiErrorLike', () => {
  it('maps a fetch TypeError to network_error', () => {
    expect(toApiErrorLike(new TypeError('Failed to fetch'))).toEqual({ code: 'network_error' });
  });

  it('keeps error, code and params of an API body', () => {
    expect(
      toApiErrorLike({ success: false, error: 'Seed 3 taken', code: 'SEED_CONFLICT', params: { seed: 3, bad: null } }),
    ).toEqual({ error: 'Seed 3 taken', code: 'SEED_CONFLICT', params: { seed: 3 } });
  });

  it('keeps the message of any other Error and of a string', () => {
    expect(toApiErrorLike(new Error('boom'))).toEqual({ error: 'boom' });
    expect(toApiErrorLike('plain')).toEqual({ error: 'plain' });
  });

  it('returns an empty object for anything else', () => {
    expect(toApiErrorLike(42)).toEqual({});
    expect(toApiErrorLike(null)).toEqual({});
  });
});

describe('apiErrorText', () => {
  const de = { locale: 'de' as const, catalogs: [errorsSeasons] };
  const en = { locale: 'en' as const, catalogs: [errorsSeasons] };

  it('English UI shows the server English text unchanged', () => {
    const res: ApiErrorLike = { error: 'The league is archived; its roster can no longer be substituted', code: 'SEASON_CLOSED' };
    expect(apiErrorText(res, en)).toBe('The league is archived; its roster can no longer be substituted');
  });

  it('translates a known code', () => {
    expect(apiErrorText({ error: 'Phase not found in this league', code: 'PHASE_NOT_FOUND' }, de)).toBe(
      'Phase in dieser Liga nicht gefunden.',
    );
  });

  it('consults errorsCommon first, without listing it', () => {
    expect(apiErrorText({ error: 'Not authenticated', code: 'unauthenticated' }, de)).toBe('Du bist nicht angemeldet.');
    expect(apiErrorText({ code: 'network_error' }, { locale: 'en', catalogs: [] })).toBe(
      'Network error. Check your connection and try again.',
    );
  });

  it('interpolates params and formats numbers per locale', () => {
    const res: ApiErrorLike = { error: 'x', code: 'SEED_CONFLICT', params: { seed: 12345 } };
    expect(apiErrorText(res, { locale: 'de', catalogs: [errorsTournaments] })).toBe(
      'Setzplatz 12.345 ist bereits an einen anderen Teilnehmer vergeben – nimm ihn in die Neusetzung auf oder wähle einen freien Setzplatz.',
    );
  });

  it('selects plural forms from count', () => {
    const one = apiErrorText({ error: 'x', code: 'REGENERATE_PLAYED', params: { count: 1 } }, { locale: 'de', catalogs: [errorsTournaments] });
    const many = apiErrorText({ error: 'x', code: 'REGENERATE_PLAYED', params: { count: 3 } }, { locale: 'de', catalogs: [errorsTournaments] });
    expect(one).toMatch(/^1 bereits gespieltes Spiel wird/);
    expect(many).toMatch(/^3 bereits gespielte Spiele werden/);
  });

  it('falls back to the English error when a required param is missing', () => {
    const res: ApiErrorLike = { error: 'Seed 7 is already held by another participant', code: 'SEED_CONFLICT' };
    expect(apiErrorText(res, { locale: 'de', catalogs: [errorsTournaments] })).toBe(res.error);
  });

  it('falls back to the English error for a code outside the given catalogs', () => {
    const res: ApiErrorLike = { error: 'Seed 7 is taken', code: 'SEED_CONFLICT', params: { seed: 7 } };
    expect(apiErrorText(res, de)).toBe('Seed 7 is taken');
    expect(apiErrorText({ error: 'Odd failure', code: 'no_such_code' }, de)).toBe('Odd failure');
  });

  it('falls back to unknown_error when there is no text at all', () => {
    expect(apiErrorText(null, de)).toBe('Da ist etwas schiefgelaufen. Bitte versuche es noch einmal.');
    expect(apiErrorText({ code: 'no_such_code' }, en)).toBe('Something went wrong. Please try again.');
    expect(apiErrorText({ error: '   ' }, en)).toBe('Something went wrong. Please try again.');
  });

  it('localizes Pokémon-name params through the pkmn localizer', () => {
    const res: ApiErrorLike = { error: 'Charmander has already been drafted', code: 'POKEMON_TAKEN', params: { pokemon: 'Charmander' } };
    expect(apiErrorText(res, { locale: 'de', catalogs: [errorsDraft], pkmn: fakeGerman })).toBe('Glumanda wurde bereits gedraftet.');
    expect(apiErrorText(res, { locale: 'de', catalogs: [errorsDraft] })).toBe('Charmander wurde bereits gedraftet.');
  });

  it('renders match-status params of match_transition_invalid as enum labels', () => {
    const res: ApiErrorLike = {
      error: 'Invalid transition: scheduled → completed',
      code: 'match_transition_invalid',
      params: { from: 'scheduled', to: 'completed' },
    };
    expect(apiErrorText(res, { locale: 'de', catalogs: [errorsMatches] })).toBe('Ungültiger Statuswechsel: Angesetzt → Beendet');
    expect(apiErrorText(res, { locale: 'en', catalogs: [errorsMatches] })).toBe('Invalid transition: scheduled → completed');
  });

  it('renders the match status param of the AI status codes as an enum label (A7)', () => {
    const analysis: ApiErrorLike = {
      error: 'Match analysis is only available for completed matches (current: scheduled)',
      code: 'ai_analysis_completed_only',
      params: { status: 'scheduled' },
    };
    const scouting: ApiErrorLike = {
      error: 'Scouting is only available for scheduled matches (current: completed)',
      code: 'ai_scouting_scheduled_only',
      params: { status: 'completed' },
    };
    const invalid: ApiErrorLike = { error: 'x', code: 'ai_match_status_invalid', params: { status: 'scheduled' } };
    const de = { locale: 'de' as const, catalogs: [errorsAi] };
    expect(apiErrorText(analysis, de)).toBe(
      'Die Spielanalyse gibt es nur für abgeschlossene Spiele (aktueller Status: Angesetzt).',
    );
    expect(apiErrorText(scouting, de)).toBe('Scouting gibt es nur für angesetzte Spiele (aktueller Status: Beendet).');
    expect(apiErrorText(invalid, de)).toContain('(aktueller Status: Angesetzt).');
    expect(apiErrorText(analysis, { locale: 'en', catalogs: [errorsAi] })).toBe(analysis.error);
  });

  it('localizes each type of a slash-joined types list', () => {
    const fakeTypes: PkmnParamLocalizer = (kind, name) =>
      kind === 'type' ? ({ Fire: 'Feuer', Water: 'Wasser', Grass: 'Pflanze' } as Record<string, string>)[name] ?? name : name;
    const conflict: ApiErrorLike = {
      error: 'Fire/Water/Grass is already assigned to another participant',
      code: 'core_types_conflict',
      params: { types: 'Fire/Water/Grass' },
    };
    const notInPool: ApiErrorLike = {
      error: 'Fire/Water/Grass is not in the season core pool',
      code: 'core_not_in_pool',
      params: { types: 'Fire/Water/Grass' },
    };
    const ctx = { locale: 'de' as const, catalogs: [errorsSeasons], pkmn: fakeTypes };
    expect(apiErrorText(conflict, ctx)).toBe('Feuer/Wasser/Pflanze ist bereits einem anderen Teilnehmer zugewiesen.');
    expect(apiErrorText(notInPool, ctx)).toBe('Feuer/Wasser/Pflanze ist nicht im Core-Pool der Saison.');
    expect(apiErrorText(notInPool, { locale: 'de', catalogs: [errorsSeasons] })).toBe(
      'Fire/Water/Grass ist nicht im Core-Pool der Saison.',
    );
  });

  it('never treats a code as a dotted path', () => {
    expect(apiErrorText({ error: 'E', code: 'PHASE_NOT_FOUND.x' }, de)).toBe('E');
  });
});

describe('useApiErrorText', () => {
  function Probe(props: { res: ApiErrorLike; pkmn?: PkmnParamLocalizer }) {
    const plain = useApiErrorText(errorsDraft);
    const withPkmn = useApiErrorTextWithPkmn(props.pkmn ?? fakeGerman, errorsDraft);
    return createElement('p', null, `${plain(props.res)}|${withPkmn(props.res)}`);
  }
  const res: ApiErrorLike = { error: 'Charmander has already been drafted', code: 'POKEMON_TAKEN', params: { pokemon: 'Charmander' } };

  it('renders in the provider locale', () => {
    const html = renderToStaticMarkup(withI18n(createElement(Probe, { res }), { locale: 'de' }));
    expect(html).toBe('<p>Charmander wurde bereits gedraftet.|Glumanda wurde bereits gedraftet.</p>');
  });

  it('renders the English server text without a provider', () => {
    const html = renderToStaticMarkup(createElement(Probe, { res }));
    expect(html).toBe('<p>Charmander has already been drafted|Charmander has already been drafted</p>');
  });
});

describe('apiErrorText for the clone refusal of a custom-format league', () => {
  it('has an English and a German text', () => {
    const res: ApiErrorLike = { error: 'A league with a custom format cannot be used as a source', code: 'SEASON_CLONE_CUSTOM_FORMAT' };
    const en = apiErrorText(res, { locale: 'en', catalogs: [errorsSeasons] });
    const de = apiErrorText(res, { locale: 'de', catalogs: [errorsSeasons] });

    expect(en).toContain('custom format');
    expect(de).toBe(
      'Eine Liga mit eigenem Format kann nicht als Vorlage dienen: Ihre Phasen kommen aus einem angehängten Format, und eine Kopie könnte keines anhängen.',
    );
  });
});
