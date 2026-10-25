import { describe, expect, it } from 'vitest';
import { buildCreateRequest, cloneFormDefaults, createFormInitialData, type CloneSourceOption } from '../clone-source';
import type { SeasonFormData } from '@/types/season';

const SOURCE: CloneSourceOption = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Autumn League',
  format_type: 'doubles',
  status: 'completed',
  archived: true,
  is_test_season: false,
  ruleset_id: '22222222-2222-4222-8222-222222222222',
  route_theme: 'sakura',
  language: 'en',
  description: 'Two on two.',
  phase_count: 3,
  participant_count: 12,
};

const FORM: SeasonFormData = {
  name: 'Spring League',
  description: 'Fresh start',
  format_type: 'doubles',
  ruleset_id: '22222222-2222-4222-8222-222222222222',
  start_date: '2027-03-01',
  end_date: null,
  route_theme: 'sakura',
  language: 'en',
};

describe('cloneFormDefaults', () => {
  it('carries the settings a new league repeats', () => {
    expect(cloneFormDefaults(SOURCE)).toEqual({
      format_type: 'doubles',
      ruleset_id: '22222222-2222-4222-8222-222222222222',
      route_theme: 'sakura',
      language: 'en',
      description: 'Two on two.',
    });
  });

  it('omits the name and the dates', () => {
    const defaults = cloneFormDefaults(SOURCE);

    expect(defaults).not.toHaveProperty('name');
    expect(defaults).not.toHaveProperty('start_date');
    expect(defaults).not.toHaveProperty('end_date');
  });
});

describe('buildCreateRequest', () => {
  it('leaves a blank request byte-identical to the form payload', () => {
    const body = buildCreateRequest(FORM, null, true);

    expect(JSON.stringify(body)).toBe(JSON.stringify(FORM));
    expect(body).not.toHaveProperty('clone_from');
  });

  it('adds clone_from with both flags for a site admin', () => {
    const body = buildCreateRequest(FORM, { sourceId: SOURCE.id, copyRoster: true, copyAdmins: true }, true);

    expect(body).toEqual({ ...FORM, clone_from: { season_id: SOURCE.id, copy_roster: true, copy_admins: true } });
  });

  it('never sends copy_admins for anyone else, even when the choice carries it', () => {
    const body = buildCreateRequest(FORM, { sourceId: SOURCE.id, copyRoster: false, copyAdmins: true }, false);

    expect(body.clone_from).toEqual({ season_id: SOURCE.id, copy_roster: false });
    expect(body.clone_from).not.toHaveProperty('copy_admins');
  });

  it('does not mutate the form payload', () => {
    const data = { ...FORM };
    buildCreateRequest(data, { sourceId: SOURCE.id, copyRoster: true, copyAdmins: false }, true);

    expect(data).toEqual(FORM);
  });
});

describe('createFormInitialData', () => {
  const TYPED = { name: 'Spring League', start_date: '2027-03-01', end_date: '2027-05-01' };

  it('keeps the typed name and dates when a source is picked', () => {
    expect(createFormInitialData(SOURCE, TYPED)).toEqual({ ...cloneFormDefaults(SOURCE), ...TYPED });
  });

  it('keeps the typed name and dates when the source is cleared again', () => {
    expect(createFormInitialData(null, TYPED)).toEqual(TYPED);
  });

  it('the source never supplies a name or dates', () => {
    const data = createFormInitialData(SOURCE, { name: '', start_date: '', end_date: '' });
    expect(data.name).toBe('');
    expect(data.start_date).toBe('');
    expect(data.end_date).toBe('');
  });
});
