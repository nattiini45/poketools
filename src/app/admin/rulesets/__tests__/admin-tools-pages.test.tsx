/**
 * T09 (i18n-core §11.3): the server pages of the admin tools translate
 * their headers through `getT(adminToolsMessages)`, which reads the
 * language cookie. The guard, the page shell and the client tools are
 * stubbed so the pages render as plain async functions (vitest 'node').
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ruleset } from '@/types/ruleset';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, { value: string }>(),
  listRulesets: vi.fn(),
  getRulesetById: vi.fn(),
  getLiveAccess: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => mocks.cookies.get(name) }),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  listRulesets: mocks.listRulesets,
  getRulesetById: mocks.getRulesetById,
}));
vi.mock('@/lib/auth/helpers', () => ({
  getLiveAccess: mocks.getLiveAccess,
  getSession: async () => null,
  isSuperadmin: () => false,
}));
// The guard renders its denial or its children; a marker lets the tests tell the two apart.
vi.mock('@/components/shared/SiteAdminGuard', () => ({
  default: ({ children }: { children: ReactNode }) => (children ? children : <p data-guard="denied">denied</p>),
}));
vi.mock('@/components/ui/PageContainer', () => ({
  default: ({
    title,
    subtitle,
    action,
    children,
  }: {
    title: string;
    subtitle?: string;
    action?: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {subtitle ? <p data-subtitle="">{subtitle}</p> : null}
      {action}
      {children}
    </main>
  ),
}));
vi.mock('@/components/ruleset/RulesetBuilder', () => ({ default: () => null }));
vi.mock('@/components/discord/DiscordWebhookManager', () => ({ default: () => null }));
vi.mock('@/components/social/SocialIntegrationManager', () => ({ default: () => null }));
vi.mock('../../data/AdminDataTools', () => ({ default: () => null }));
vi.mock('../../meta-data/MetaDataConsole', () => ({ default: () => null }));
vi.mock('../../audit/AuditLogBrowser', () => ({ default: () => null }));
vi.mock('../../achievements/AchievementDefinitionsManager', () => ({ default: () => null }));
vi.mock('../../wiki/WikiModerationPanel', () => ({ default: () => null }));

import AdminRulesetsPage from '../page';
import NewRulesetPage from '../new/page';
import EditRulesetPage from '../[id]/edit/page';
import AdminDataPage from '../../data/page';
import AdminMetaDataPage from '../../meta-data/page';
import AdminAuditPage from '../../audit/page';
import AdminAchievementsPage from '../../achievements/page';
import AdminWikiPage from '../../wiki/page';
import AdminSocialPage from '../../social/page';

function ruleset(overrides: Partial<Ruleset> = {}): Ruleset {
  return {
    id: 'rs-1',
    name: 'Example Rules',
    base_format: 'gen9natdex',
    is_doubles: true,
    clauses: ['Species Clause', 'Sleep Clause Mod', 'OHKO Clause'],
    bans: { pokemon: ['Koraidon'], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] },
    custom_rules_string: null,
    min_shared_type_pct: 0,
    team_constraints: null,
    ...overrides,
  } as unknown as Ruleset;
}

async function html(page: Promise<ReactNode>): Promise<string> {
  return renderToStaticMarkup(<>{await page}</>);
}

function useLanguage(locale: 'en' | 'de' | null) {
  mocks.cookies.clear();
  if (locale) mocks.cookies.set('plc_locale', { value: locale });
}

const RULESET_ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';

beforeEach(() => {
  mocks.listRulesets.mockReset();
  mocks.getRulesetById.mockReset();
  mocks.getLiveAccess.mockReset();
  mocks.getLiveAccess.mockResolvedValue({ player: null, isSiteAdmin: true, isAnyAdmin: true, isCreator: true });
});

describe('admin rulesets pages', () => {
  it('render English by default with plural badges', async () => {
    useLanguage(null);
    mocks.listRulesets.mockResolvedValue([ruleset()]);
    const out = await html(AdminRulesetsPage());
    expect(out).toContain('Manage Rulesets');
    expect(out).toContain('+ New Ruleset');
    expect(out).toContain('Doubles');
    expect(out).toContain('3 clauses');
    expect(out).toContain('1 ban<');
  });

  it('render German from the language cookie', async () => {
    useLanguage('de');
    mocks.listRulesets.mockResolvedValue([ruleset()]);
    const out = await html(AdminRulesetsPage());
    expect(out).toContain('Regelwerke verwalten');
    expect(out).toContain('+ Neues Regelwerk');
    expect(out).toContain('Doppel');
    expect(out).toContain('3 Klauseln');
    expect(out).toContain('1 Ban<');

    mocks.listRulesets.mockResolvedValue([]);
    expect(await html(AdminRulesetsPage())).toContain('Noch keine Regelwerke.');
    expect(await html(NewRulesetPage())).toContain('Regelwerk erstellen');

    mocks.getRulesetById.mockResolvedValue(ruleset());
    expect(await html(EditRulesetPage({ params: Promise.resolve({ id: RULESET_ID }) }))).toContain(
      'Regelwerk bearbeiten: Example Rules',
    );
  });
});

describe('ruleset pages that read data gate before the read', () => {
  it.each([
    ['a resource admin', { player: null, isSiteAdmin: false, isAnyAdmin: true, isCreator: false }],
    ['a signed-out visitor', null],
  ])('%s: no ruleset is read, the site-admin guard decides', async (_who, access) => {
    mocks.getLiveAccess.mockResolvedValue(access);

    const list = await html(AdminRulesetsPage());
    const edit = await html(EditRulesetPage({ params: Promise.resolve({ id: RULESET_ID }) }));

    expect(list).toContain('data-guard="denied"');
    expect(edit).toContain('data-guard="denied"');
    expect(mocks.listRulesets).not.toHaveBeenCalled();
    expect(mocks.getRulesetById).not.toHaveBeenCalled();
  });

  it('a site admin gets the edit page, and a non-uuid id is a 404 before the read', async () => {
    mocks.getRulesetById.mockResolvedValue(ruleset());
    expect(await html(EditRulesetPage({ params: Promise.resolve({ id: RULESET_ID }) }))).toContain('Example Rules');

    mocks.getRulesetById.mockClear();
    await expect(EditRulesetPage({ params: Promise.resolve({ id: 'rs-1' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getRulesetById).not.toHaveBeenCalled();
  });
});

describe('admin tool page headers', () => {
  it('translate title, subtitle and the back button', async () => {
    useLanguage('de');
    const data = await html(AdminDataPage());
    expect(data).toContain('Datenwerkzeuge');
    expect(data).toContain('Spieler importieren und Betriebsdaten exportieren');
    expect(data).toContain('>Admin<');

    expect(await html(AdminMetaDataPage())).toContain('Meta-Daten');
    expect(await html(AdminAuditPage())).toContain('Protokoll');
    expect(await html(AdminAchievementsPage())).toContain('Erfolgsdefinitionen');
    expect(await html(AdminWikiPage())).toContain('Wiki-Moderation');

    const social = await html(AdminSocialPage());
    expect(social).toContain('Social-Integration');
    expect(social).toContain('Richte Discord-Webhook-URLs pro Bereich und Ereignistyp ein.');
  });

  it('keep the English literals in English', async () => {
    useLanguage('en');
    expect(await html(AdminDataPage())).toContain('Import players and export operational data');
    expect(await html(AdminAuditPage())).toContain('Review administrative and system activity');
    expect(await html(AdminSocialPage())).toContain('Configure outbound notifications for Discord, X, Threads, and Bluesky.');
  });
});
