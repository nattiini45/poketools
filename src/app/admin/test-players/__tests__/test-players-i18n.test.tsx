/**
 * The Test Players page and console render from the `admin-test-players`
 * namespace in both languages. Effects do not run under
 * `renderToStaticMarkup`, so the console renders its initial (loading) state
 * without fetching.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { apiErrorText } from '@/i18n/api-errors';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminTestPlayersMessages } from '@/i18n/messages/admin-test-players';
import type { Player } from '@/types/player';
import TestPlayersConsole, { TestPlayersTable } from '../TestPlayersConsole';
import {
  errorText,
  noticeText,
  type ConsoleError,
  type ConsoleNotice,
  type PlayerActionKey,
} from '../test-players-text';

const mocks = vi.hoisted(() => ({ locale: 'en' as 'en' | 'de' }));

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator: create } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale,
    getT: async (ns: Parameters<typeof create>[0]) => create(ns, mocks.locale),
  };
});
vi.mock('@/components/shared/SiteAdminGuard', () => ({
  default: ({ children }: { children?: unknown }) => children ?? null,
}));

import AdminTestPlayersPage from '../page';

const en = createTranslator(adminTestPlayersMessages, 'en');
const de = createTranslator(adminTestPlayersMessages, 'de');

function translators(locale: Locale) {
  const t = locale === 'de' ? de : en;
  const apiText = (res: Parameters<typeof apiErrorText>[0]) => apiErrorText(res, { locale, catalogs: [errorsAdmin] });
  return { t, apiText };
}

describe('admin-test-players messages', () => {
  it('keeps the English literals verbatim', () => {
    expect(en('standard.ensure')).toBe('Create / Repair 14 Test Players');
    expect(en('season.idLabel')).toBe('Season UUID');
    expect(en('season.deleteMatches')).toBe('Delete Test-Only Matches');
    expect(en('standard.loading')).toBe('Loading test accounts…');
    expect(en('page.title')).toBe('Test Players');
  });

  it('uses real plurals instead of "(s)"', () => {
    expect(en('notice.ensured', { count: 1 })).toBe('Ensured 1 standard test player.');
    expect(en('notice.ensured', { count: 14 })).toBe('Ensured 14 standard test players.');
    expect(en('notice.deleted', { count: 1, season: 's1' })).toBe('Deleted 1 test-only match in season s1.');
    expect(en('notice.deleted', { count: 3, season: 's1' })).toBe('Deleted 3 test-only matches in season s1.');
    expect(de('notice.ensured', { count: 14 })).toBe('14 Standard-Testspieler sichergestellt.');
    expect(de('notice.deleted', { count: 1, season: 's1' })).toBe('1 Nur-Test-Match in Saison s1 gelöscht.');
    expect(de('notice.deleted', { count: 3, season: 's1' })).toBe('3 Nur-Test-Matches in Saison s1 gelöscht.');
  });
});

describe('TestPlayersConsole', () => {
  it('renders in English', () => {
    const html = renderWithI18n(<TestPlayersConsole />);
    for (const text of [
      'Standard Test Players',
      'Create / Repair 14 Test Players',
      'Refresh',
      'Loading test accounts…',
      'Season-Level Test Data',
      'Season UUID',
      'Remove from Season</strong> on a player row',
      'Delete Test-Only Matches',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/<code[^>]*>is_test_account<\/code>/);
    expect(html).toContain('<strong>both</strong>');
  });

  it('renders in German', () => {
    const html = renderWithI18n(<TestPlayersConsole />, { locale: 'de' });
    for (const text of [
      'Standard-Testspieler',
      '14 Testspieler erstellen / reparieren',
      'Aktualisieren',
      'Testkonten werden geladen …',
      'Testdaten auf Saison-Ebene',
      'Saison-UUID',
      '<strong>Aus Saison entfernen</strong> in einer Spielerzeile',
      'Nur-Test-Matches löschen',
      '<strong>beide</strong>',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/<code[^>]*>is_test_account<\/code>/);
    for (const english of ['Standard Test Players', 'Season-Level Test Data', 'Season UUID', 'Refresh', 'Loading test accounts']) {
      expect(html).not.toContain(english);
    }
  });
});

describe('TestPlayersTable', () => {
  const players = [
    { id: 'p1', name: 'EvoTest01', ps_username: 'evotest01', auth_user_id: 'auth-1' },
    { id: 'p2', name: 'EvoTest02', ps_username: '', auth_user_id: null },
  ] as unknown as Player[];

  function render(locale: Locale): string {
    return renderWithI18n(<TestPlayersTable players={players} busyAction={null} seasonId="" onAction={() => {}} onRemoveFromSeason={() => {}} />, { locale });
  }

  it('renders headers, badge, login states and buttons in English', () => {
    const html = render('en');
    for (const text of ['>Name<', '>PS Username<', '>Login<', '>Actions<']) expect(html).toContain(text);
    expect(html).toContain('>Test<');
    expect(html).toContain('>enabled<');
    expect(html).toContain('>disabled<');
    expect(html).toContain('Reset Data');
    expect(html).toContain('Reset Login');
    expect(html).toContain('Clear Login');
    expect(html).toContain('Mint Login');
    expect(html).toContain('Remove from Season');
  });

  it('renders headers, badge, login states and buttons in German', () => {
    const html = render('de');
    for (const text of ['>Name<', '>PS-Benutzername<', '>Login<', '>Aktionen<']) expect(html).toContain(text);
    expect(html).toContain('>Test<');
    expect(html).toContain('>aktiviert<');
    expect(html).toContain('>deaktiviert<');
    expect(html).toContain('Daten zurücksetzen');
    expect(html).toContain('Login zurücksetzen');
    expect(html).toContain('Login entfernen');
    expect(html).toContain('Login erzeugen');
    expect(html).toContain('>Aus Saison entfernen<');
    expect(html).not.toContain('Mint Login');
    expect(html).not.toContain('Remove from Season');
  });

  it('shows Clear Login only for a player with a login', () => {
    const one = renderWithI18n(
      <TestPlayersTable players={[players[1]]} busyAction={null} seasonId="" onAction={() => {}} onRemoveFromSeason={() => {}} />,
    );
    expect(one).toContain('Mint Login');
    expect(one).not.toContain('Clear Login');
    expect(one).not.toContain('Reset Login');
  });
});

describe('minted credentials note', () => {
  it('names the button the row shows once a login exists, in both languages', () => {
    expect(en('standard.mintedNote')).toContain(`"${en('actions.resetLogin')}"`);
    expect(de('standard.mintedNote')).toContain(`„${de('actions.resetLogin')}“`);
  });
});

describe('noticeText', () => {
  const cases: Array<[ConsoleNotice, string, string]> = [
    [{ kind: 'ensured', count: 1 }, 'Ensured 1 standard test player.', '1 Standard-Testspieler sichergestellt.'],
    [{ kind: 'ensured', count: 14 }, 'Ensured 14 standard test players.', '14 Standard-Testspieler sichergestellt.'],
    [{ kind: 'minted', name: 'EvoTest01' }, 'Login credentials minted for EvoTest01.', 'Login-Daten für EvoTest01 erzeugt.'],
    [{ kind: 'done', action: 'reset', name: 'Ash' }, 'Reset data — done for Ash.', 'Daten zurückgesetzt – für Ash erledigt.'],
    [{ kind: 'done', action: 'mint_login', name: 'Ash' }, 'Mint login — done for Ash.', 'Login erzeugt – für Ash erledigt.'],
    [{ kind: 'done', action: 'clear_login', name: 'Ash' }, 'Clear login — done for Ash.', 'Login entfernt – für Ash erledigt.'],
    [{ kind: 'removed', name: 'Ash', season: 's1' }, 'Removed Ash from season s1.', 'Ash aus Saison s1 entfernt.'],
    [{ kind: 'deleted', count: 1, season: 's1' }, 'Deleted 1 test-only match in season s1.', '1 Nur-Test-Match in Saison s1 gelöscht.'],
    [{ kind: 'deleted', count: 3, season: 's1' }, 'Deleted 3 test-only matches in season s1.', '3 Nur-Test-Matches in Saison s1 gelöscht.'],
  ];

  it.each(cases)('renders %j in both languages', (notice, english, german) => {
    expect(noticeText(en, notice)).toBe(english);
    expect(noticeText(de, notice)).toBe(german);
  });
});

describe('errorText', () => {
  it('translates a local error', () => {
    const en_ = translators('en');
    const de_ = translators('de');
    expect(errorText(en_.t, en_.apiText, { local: 'error.network' })).toBe('Network error');
    expect(errorText(de_.t, de_.apiText, { local: 'error.network' })).toBe('Netzwerkfehler');
    expect(errorText(de_.t, de_.apiText, { local: 'error.seasonRequiredRemove' })).toContain('UUID der Saison');
  });

  it('shows the server text of an uncatalogued error', () => {
    const { t, apiText } = translators('en');
    expect(errorText(t, apiText, { api: { error: 'Boom' }, fallback: 'error.ensureFailed' })).toBe('Boom');
  });

  it('renders a catalogued code in the viewer language', () => {
    const body: ConsoleError = {
      api: { error: 'season_id required', code: 'admin_param_required', params: { name: 'season_id' } },
      fallback: 'error.deleteMatchesFailed',
    };
    const en_ = translators('en');
    const de_ = translators('de');
    expect(errorText(en_.t, en_.apiText, body)).toBe('season_id required');
    expect(errorText(de_.t, de_.apiText, body)).toBe('season_id fehlt.');
  });

  it('falls back to the action text when the body has neither error nor code', () => {
    const en_ = translators('en');
    const de_ = translators('de');
    const actions: PlayerActionKey[] = ['reset', 'mint_login', 'clear_login'];
    const english = ['Reset data failed', 'Mint login failed', 'Clear login failed'];
    actions.forEach((action, i) => {
      const error: ConsoleError = { api: {}, fallback: `error.failed.${action}` };
      expect(errorText(en_.t, en_.apiText, error)).toBe(english[i]);
      expect(errorText(de_.t, de_.apiText, error)).toMatch(/fehlgeschlagen$/);
    });
    expect(errorText(en_.t, en_.apiText, { api: {}, fallback: 'error.loadFailed' })).toBe('Failed to load test accounts');
  });
});

describe('AdminTestPlayersPage', () => {
  async function header(locale: Locale): Promise<{ title: unknown; subtitle: unknown; back: string }> {
    mocks.locale = locale;
    const tree = await AdminTestPlayersPage();
    const container = (tree as ReactElement<{ children: ReactElement<Record<string, unknown>> }>).props.children;
    const action = container.props.action as ReactNode;
    const texts: string[] = [];
    const visit = (node: ReactNode): void => {
      if (typeof node === 'string') texts.push(node);
      else if (Array.isArray(node)) node.forEach(visit);
      else if (isValidElement<{ children?: ReactNode }>(node)) visit(node.props.children);
    };
    visit(action);
    return { title: container.props.title, subtitle: container.props.subtitle, back: texts.join('') };
  }

  it('renders the header in German', async () => {
    const h = await header('de');
    expect(h.title).toBe('Testspieler');
    expect(String(h.subtitle)).toContain('Dummy-Konten');
    expect(h.back).toBe('Admin');
  });

  it('renders the header in English', async () => {
    const h = await header('en');
    expect(h.title).toBe('Test Players');
    expect(String(h.subtitle)).toContain('14 isolated dummy accounts');
    expect(h.back).toBe('Admin');
  });
});

describe('i18n allowlist', () => {
  it('no longer exempts the Test Players page', () => {
    const file = path.join(process.cwd(), 'scripts', 'i18n-allowlist.json');
    const { files } = JSON.parse(readFileSync(file, 'utf8')) as { files: Array<{ glob: string }> };
    expect(files.filter((entry) => entry.glob.includes('test-players'))).toEqual([]);
  });
});
