/**
 * The league workspace tab strip: a `<nav>` landmark of links (`?tab=`), the active
 * one marked `aria-current="page"` and pointing at the panel, each on a skewed plate with its item icon, a strip that
 * scrolls sideways inside itself on a phone, and 44 px tall tabs there.
 * Node + static markup (the client pieces are stubbed).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LEAGUE_ADMIN_TABS, type LeagueAdminTab } from '@/lib/league-admin/tabs';

vi.mock('next/link', () => ({
  default: ({ children, href, prefetch: _prefetch, scroll: _scroll, ...rest }: Record<string, unknown>) => (
    <a href={String(href)} {...rest}>
      {children as ReactNode}
    </a>
  ),
}));
vi.mock('@/components/league/hub/HubTabStripScroll', () => ({ default: () => null }));
vi.mock('../_components/AdminTabPending', () => ({ default: () => null }));
vi.mock('../_components/UnsavedTabGuard', () => ({
  default: ({ panelId, message }: { panelId: string; message: string }) => (
    <span data-unsaved-guard={panelId} data-message={message} />
  ),
}));

const { default: LeagueAdminTabs, LEAGUE_ADMIN_PANEL_ID } = await import('../_components/LeagueAdminTabs');

const LABELS: Record<LeagueAdminTab, string> = {
  overview: 'Overview',
  participants: 'Participants',
  phases: 'Phases',
  format: 'Format and rules',
  draft: 'Draft',
  live: 'Live format',
  settings: 'Settings',
};

function html(activeTab: LeagueAdminTab, tabs: readonly LeagueAdminTab[] = LEAGUE_ADMIN_TABS): string {
  return renderToStaticMarkup(
    <LeagueAdminTabs
      leagueId="s1"
      tabs={tabs}
      activeTab={activeTab}
      labels={LABELS}
      navLabel="League admin sections"
      unsavedConfirm="This tab has unsaved changes. Switch tabs and lose them?"
    />,
  );
}

describe('LeagueAdminTabs', () => {
  it('is a named nav landmark with one link per tab', () => {
    const out = html('overview');
    expect(out).toMatch(/^<nav aria-label="League admin sections"/);
    expect(out.match(/<a /g)).toHaveLength(LEAGUE_ADMIN_TABS.length);
    expect(out).toContain('href="/admin/leagues/s1?tab=format"');
    expect(out).toContain('href="/admin/leagues/s1"');
    expect(out).toContain('href="/admin/leagues/s1?tab=settings"');
    // The former Rules and Danger zone tabs are sections now: no tab links to them.
    expect(out).not.toContain('?tab=rules');
    expect(out).not.toContain('?tab=danger');
  });

  it('marks only the active tab, which controls the panel', () => {
    const out = html('format');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/<a href="\/admin\/leagues\/s1\?tab=format" id="league-admin-tab-format" aria-current="page" aria-controls="league-admin-panel"/);
    expect(LEAGUE_ADMIN_PANEL_ID).toBe('league-admin-panel');
    expect(out.match(/aria-controls=/g)).toHaveLength(1);
  });

  it('guards the panel region against a tab switch with unsaved input (one guard, the panel id, the copy)', () => {
    const out = html('phases');
    expect(out.match(/data-unsaved-guard=/g)).toHaveLength(1);
    expect(out).toContain('data-unsaved-guard="league-admin-panel"');
    expect(out).toContain('data-message="This tab has unsaved changes. Switch tabs and lose them?"');
    // Every tab link carries the hook the guard's click listener looks for.
    expect(out.match(/<a [^>]*data-admin-tab="/g)).toHaveLength(LEAGUE_ADMIN_TABS.length);
  });

  it('links the live tab with its label and marks it when it is the open one', () => {
    const out = html('live');
    expect(out).toContain('href="/admin/leagues/s1?tab=live"');
    expect(out).toMatch(/<a href="\/admin\/leagues\/s1\?tab=live" id="league-admin-tab-live" aria-current="page" aria-controls="league-admin-panel"/);
    expect(out).toContain('Live format');
  });

  it('renders only the tabs it is given', () => {
    const out = html('overview', ['overview', 'participants', 'phases', 'settings']);
    expect(out).not.toContain('?tab=live');
    expect(out).not.toContain('?tab=draft');
    expect(out).not.toContain('?tab=format');
  });

  it('every tab sits on a plate with its item icon; only the active plate has the accent underside', () => {
    const out = html('phases');
    expect(out.match(/data-variant="tab"/g)).toHaveLength(LEAGUE_ADMIN_TABS.length);
    expect(out.match(/skew-plate-underside/g)).toHaveLength(1);
    // The icons are decoration: the label names the tab.
    for (const icon of out.match(/<img [^>]*>/g) ?? []) {
      expect(icon).toContain('alt=""');
      expect(icon).toContain('aria-hidden="true"');
    }
    for (const label of Object.values(LABELS)) expect(out).toContain(label);
  });

  it('scrolls sideways inside the strip on a phone and wraps from md up, no fixed label width, 44 px tabs on phones', () => {
    const out = html('overview');
    expect(out).toContain('overflow-x-auto');
    expect(out).toContain('md:flex-wrap');
    expect(out).toContain('min-w-0');
    expect(out).toContain('min-h-11');
    expect(out).toContain('sm:min-h-0');
    expect(out).toContain('whitespace-nowrap');
    expect(out).not.toMatch(/(?<![\w-])w-\d|min-w-[1-9]/);
  });

  it('animates only under prefers-reduced-motion: no-preference', () => {
    expect(html('overview')).not.toMatch(/(?<!motion-safe:)\btransition-/);
  });
});
