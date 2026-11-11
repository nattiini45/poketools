import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

const session = vi.hoisted(() => ({
  current: null as null | { user: { image: null }; player: Record<string, unknown> },
}));
const nav = vi.hoisted(() => ({ pathname: '/leagues' }));

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: session.current }) }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../DiscordLoginButton', () => ({ default: () => <span data-stub="auth" />, signOutAndClearCaches: () => {} }));
vi.mock('../PwaInstallPrompt', () => ({ default: () => null }));
vi.mock('../PlayerAvatar', () => ({
  default: ({ className }: { className?: string }) => <span data-stub="avatar" className={className} />,
}));
vi.mock('@/components/notifications/NotificationBell', () => ({ default: () => <span data-stub="bell" /> }));

import NavBar from '../NavBar';
import BottomTabBar from '../nav/BottomTabBar';

const PLAYER = { playerId: 'p1', name: 'Fixture League Admin', avatarUrl: null, isAdmin: false, isCreator: false, isResourceAdmin: false };
const ADMIN = { ...PLAYER, isAdmin: true, isCreator: true };
const HISTORY = [{ href: '/history', label: 'History' }];

/** The hrefs of the desktop link row, in order. */
function rowLinks(html: string): string[] {
  const row = html.slice(html.indexOf('lg:flex'), html.indexOf('aria-label="Search"'));
  return [...row.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);
}

describe('NavBar link row', () => {
  it('shows a visitor four links, More, search and Sign in, and no bell', () => {
    session.current = null;
    const html = renderWithI18n(<NavBar />);
    expect(rowLinks(html)).toEqual(['/leagues', '/tournaments', '/insights', '/wiki']);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>(?:(?!<\/button>).)*More/s);
    expect(html).toContain('aria-label="Search"');
    expect(html).toContain('data-stub="auth"');
    expect(html).not.toContain('data-stub="bell"');
  });

  it('shows a player Home and Teams as well, the bell and the account menu, and no hamburger', () => {
    session.current = { user: { image: null }, player: PLAYER };
    const html = renderWithI18n(<NavBar />);
    expect(rowLinks(html)).toEqual(['/dashboard', '/leagues', '/tournaments', '/teambuilder', '/insights', '/wiki']);
    expect(html).toContain('data-stub="bell"');
    expect(html).toContain('aria-label="Account menu"');
    expect(html).not.toContain('aria-controls="navbar-drawer"');
    expect(html).not.toContain('data-stub="auth"');
  });

  it('never puts Admin or Creator Hub in the bar, whatever the role', () => {
    session.current = { user: { image: null }, player: ADMIN };
    const html = renderWithI18n(<NavBar />);
    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain('href="/creator"');
  });

  it('marks the current page and puts it on the gold plate', () => {
    session.current = null;
    const html = renderWithI18n(<NavBar />);
    const current = html.match(/<a [^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/leagues"');
    expect(html).toMatch(/href="\/leagues"(?:(?!<\/a>).)*bg-tier-1/s);
  });

  it('keeps the closed menus out of the markup: More, the account menu and the drawer render on demand', () => {
    session.current = { user: { image: null }, player: PLAYER };
    const html = renderWithI18n(<NavBar extraLinks={HISTORY} />);
    expect(html).not.toContain('href="/replays"');
    expect(html).not.toContain('href="/history"');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('role="dialog"');
  });

  it('gives a visitor the hamburger below lg, wired to the drawer', () => {
    session.current = null;
    const html = renderWithI18n(<NavBar />);
    const button = html.match(/<button[^>]*aria-controls="navbar-drawer"[^>]*>/)?.[0] ?? '';
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('lg:hidden');
    expect(button).toContain('aria-label="Toggle menu"');
  });

  it('is one labelled navigation landmark, 64 px tall, in German too', () => {
    session.current = { user: { image: null }, player: PLAYER };
    const html = renderWithI18n(<NavBar />, { locale: 'de' });
    expect(html).toMatch(/<nav id="site-nav"[^>]*aria-label="Hauptnavigation"/);
    expect(html).toContain('flex h-16 items-center');
    expect(html).toContain('Turniere');
    expect(html).toContain('aria-label="Kontomenü"');
    expect(html).toContain('aria-label="Suche"');
  });

  it('keeps the name out of the bar below 2xl and reachable as the trigger title', () => {
    session.current = { user: { image: null }, player: PLAYER };
    const html = renderWithI18n(<NavBar />);
    const trigger = html.match(/<button[^>]*aria-label="Account menu"[^>]*>/)?.[0] ?? '';
    expect(trigger).toContain('title="Fixture League Admin"');
    const name = html.match(/<span[^>]*>(?=Fixture League Admin<\/span>)/)?.[0] ?? '';
    expect(name).toContain('truncate');
    expect(name).toContain('2xl:block');
  });
});

describe('BottomTabBar', () => {
  it('renders nothing for a visitor', () => {
    session.current = null;
    expect(renderWithI18n(<BottomTabBar />)).toBe('');
  });

  it('gives a player Home, Leagues, Teams, Wiki and More, with the current tab marked', () => {
    session.current = { user: { image: null }, player: PLAYER };
    const html = renderWithI18n(<BottomTabBar extraLinks={HISTORY} />);
    expect([...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1])).toEqual(['/dashboard', '/leagues', '/teambuilder', '/wiki']);
    expect(html).toMatch(/<a [^>]*href="\/leagues"[^>]*aria-current="page"/);
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
    expect(html).toContain('aria-label="Quick navigation"');
    expect(html.startsWith('<div data-site-bottom-bar=""')).toBe(true);
  });

  it('marks More while one of its pages is open, extension pages included', () => {
    session.current = { user: { image: null }, player: PLAYER };
    nav.pathname = '/history/season-1';
    const html = renderWithI18n(<BottomTabBar extraLinks={HISTORY} />);
    nav.pathname = '/leagues';
    expect(html).not.toContain('aria-current="page"');
    expect(html).toMatch(/<button[^>]*class="[^"]*font-\[550\][^"]*"[^>]*>/);
  });

  it('speaks German', () => {
    session.current = { user: { image: null }, player: PLAYER };
    const html = renderWithI18n(<BottomTabBar />, { locale: 'de' });
    for (const label of ['Start', 'Ligen', 'Teams', 'Wiki', 'Mehr']) expect(html).toContain(`>${label}</span>`);
  });
});
