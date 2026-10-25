/**
 * The standalone tournament settings editor: the form shows the stored
 * values, a started tournament freezes bracket type, ruleset and doubles, and
 * the submit path sends only a changed patch (and nothing when nothing changed).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Ruleset } from '@/types/ruleset';
import type { TournamentFormData } from '@/types/tournament';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import TournamentSettingsEditor, { saveTournamentSettings } from '../TournamentSettingsEditor';

const ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';
const RULESET_ID = '11111111-1111-4111-8111-111111111111';
const rulesets = [{ id: RULESET_ID, name: 'Standard Rules' }] as unknown as Ruleset[];

const tournament = {
  id: ID,
  name: 'Spring Cup',
  bracket_type: 'double_elim' as const,
  ruleset_id: RULESET_ID,
  best_of_default: 5,
  bo_overrides: { Finals: 7 },
  is_doubles: true,
  team_visibility: 'always_public' as const,
  bracket_reset_enabled: false,
};

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether an opening tag carries the `disabled` attribute (not the `disabled:` utility classes). */
const isDisabled = (tag: string): boolean => /\sdisabled(=""|\s|>)/.test(tag);

function tagWithId(html: string, id: string): string {
  const match = html.match(new RegExp(`<[a-z]+[^>]*id="${escapeRe(id)}"[^>]*>`));
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

function untouched(overrides: Partial<TournamentFormData> = {}): TournamentFormData {
  return {
    name: tournament.name,
    bracket_type: tournament.bracket_type,
    ruleset_id: tournament.ruleset_id,
    best_of_default: tournament.best_of_default,
    bo_overrides: tournament.bo_overrides,
    is_doubles: tournament.is_doubles,
    team_visibility: tournament.team_visibility,
    bracket_reset_enabled: tournament.bracket_reset_enabled,
    ...overrides,
  };
}

const open = { bracketType: false, ruleset: false, doubles: false };
const locked = { bracketType: true, ruleset: true, doubles: true };

describe('TournamentSettingsEditor render', () => {
  it('shows the stored values with the save label', () => {
    const html = renderToStaticMarkup(
      <TournamentSettingsEditor tournament={tournament} rulesets={rulesets} started={false} />,
    );

    expect(html).toContain('value="Spring Cup"');
    expect(html).toContain('Save changes');
    expect(html).toMatch(/<option value="5" selected="">Bo5<\/option>/);
    expect(html).toMatch(/<option value="always_public" selected="">/);
    expect(html).toMatch(/<option value="[0-9a-f-]+" selected="">Standard Rules<\/option>/);
    expect(tagWithId(html, 'isDoubles')).toContain('checked');
    expect(html).not.toContain('role="status"');
  });

  it('leaves bracket type, ruleset and doubles editable before the start', () => {
    const html = renderToStaticMarkup(
      <TournamentSettingsEditor tournament={tournament} rulesets={rulesets} started={false} />,
    );
    expect(isDisabled(tagWithId(html, 'bracket-type'))).toBe(false);
    expect(isDisabled(tagWithId(html, 'ruleset'))).toBe(false);
    expect(isDisabled(tagWithId(html, 'isDoubles'))).toBe(false);
  });

  it('freezes all three once the tournament has started', () => {
    const html = renderToStaticMarkup(
      <TournamentSettingsEditor tournament={tournament} rulesets={rulesets} started />,
    );
    expect(isDisabled(tagWithId(html, 'bracket-type'))).toBe(true);
    expect(isDisabled(tagWithId(html, 'ruleset'))).toBe(true);
    expect(isDisabled(tagWithId(html, 'isDoubles'))).toBe(true);
    expect(html.match(/Locked: the tournament has started\./g)).toHaveLength(3);
  });

  it('explains the lock of an upcoming tournament that has a generated round', () => {
    const html = renderToStaticMarkup(
      <TournamentSettingsEditor tournament={tournament} rulesets={rulesets} started lockReason="rounds" />,
    );
    expect(isDisabled(tagWithId(html, 'bracket-type'))).toBe(true);
    expect(html.match(/Locked: rounds have been generated\./g)).toHaveLength(3);
    expect(html).not.toContain('the tournament has started');
  });
});

describe('saveTournamentSettings', () => {
  it('makes no request when nothing changed', async () => {
    const fetchImpl = vi.fn();
    await expect(
      saveTournamentSettings(tournament, untouched(), open, fetchImpl as unknown as typeof fetch),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('makes no request when only a locked control changed', async () => {
    const fetchImpl = vi.fn();
    await expect(
      saveTournamentSettings(
        tournament,
        untouched({ bracket_type: 'swiss', is_doubles: false }),
        locked,
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('PATCHes only the changed keys to the tournament endpoint', async () => {
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ success: true, data: {} }) }) as unknown as Response);

    await expect(
      saveTournamentSettings(
        tournament,
        untouched({ name: ' Autumn Cup ', bo_overrides: undefined }),
        locked,
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/tournaments/${ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Autumn Cup', bo_overrides: {} });
  });

  it('throws the API failure with its code so the form renders it by code', async () => {
    const body = {
      success: false,
      error: 'The bracket type cannot be changed once the tournament has started.',
      code: 'tournament_bracket_locked',
    };
    const fetchImpl = vi.fn(async () => ({ json: async () => body }) as unknown as Response);

    await expect(
      saveTournamentSettings(
        tournament,
        untouched({ bracket_type: 'swiss' }),
        open,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ message: body.error, error: body.error, code: 'tournament_bracket_locked' });
  });

  it('throws an empty-message error for a body that is not JSON, so the form shows its generic text', async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          json: async () => {
            throw new SyntaxError('Unexpected token');
          },
        }) as unknown as Response,
    );

    await expect(
      saveTournamentSettings(tournament, untouched({ name: 'X' }), open, fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ message: '' });
  });
});
