/**
 * The league admin tab strip: a `<nav>` landmark of links (`?tab=`), the active
 * one marked `aria-current="page"` and pointing at the panel, a strip that
 * scrolls sideways inside itself, and 44 px tall tabs on phones.
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
  draft: 'Draft',
  phases: 'Phases',
  rules: 'Rules',
  format: 'Format',
  settings: 'Settings',
  danger: 'Danger zone',
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
    expect(out).toContain('href="/admin/leagues/s1?tab=danger"');
  });

  it('marks only the active tab, which controls the panel', () => {
    const out = html('rules');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/<a href="\/admin\/leagues\/s1\?tab=rules"[^>]*aria-current="page"[^>]*aria-controls="league-admin-panel"/);
    expect(LEAGUE_ADMIN_PANEL_ID).toBe('league-admin-panel');
    expect(out).toContain('id="league-admin-tab-rules"');
  });

  it('guards the panel region against a tab switch with unsaved input (one guard, the panel id, the copy)', () => {
    const out = html('phases');
    expect(out.match(/data-unsaved-guard=/g)).toHaveLength(1);
    expect(out).toContain('data-unsaved-guard="league-admin-panel"');
    expect(out).toContain('data-message="This tab has unsaved changes. Switch tabs and lose them?"');
    // Every tab link carries the hook the guard's click listener looks for.
    expect(out.match(/<a [^>]*data-admin-tab="/g)).toHaveLength(LEAGUE_ADMIN_TABS.length);
  });

  it('renders only the tabs it is given', () => {
    const out = html('overview', ['overview', 'participants', 'phases', 'settings', 'danger']);
    expect(out).not.toContain('?tab=draft');
    expect(out).not.toContain('?tab=format');
    expect(out).not.toContain('?tab=rules');
  });

  it('scrolls sideways inside the strip, no fixed label width, 44 px tabs on phones', () => {
    const out = html('overview');
    expect(out).toContain('overflow-x-auto');
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
