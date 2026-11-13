import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_NAV_LINKS,
  BOTTOM_BAR_LINKS,
  BOTTOM_SHEET_LINKS,
  MORE_NAV_LINKS,
  extensionLinkIcon,
  isNavPathActive,
  primaryNavLinks,
} from '../nav/links';
import { navMessages } from '@/i18n/messages/nav';

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const hrefs = (links: readonly { href: string }[]) => links.map((link) => link.href);

describe('site nav link groups (plan §3.1)', () => {
  it('gives a visitor Leagues, Tournaments, Insights and Wiki', () => {
    expect(hrefs(primaryNavLinks(false))).toEqual(['/leagues', '/tournaments', '/insights', '/wiki']);
  });

  it('gives a player Home first and Replays', () => {
    expect(hrefs(primaryNavLinks(true))).toEqual(['/dashboard', '/leagues', '/tournaments', '/replays', '/insights', '/wiki']);
  });

  it('keeps Teams and Players reachable under More', () => {
    expect(MORE_NAV_LINKS).toContainEqual({ href: '/teambuilder', labelKey: 'teams', icon: 'choice-scarf', also: ['/teams'] });
    expect(hrefs(MORE_NAV_LINKS)).toEqual(['/teambuilder', '/players']);
  });

  it('splits every destination between the bottom bar and its sheet, with no admin or creator link', () => {
    expect(hrefs(BOTTOM_BAR_LINKS)).toEqual(['/dashboard', '/leagues', '/replays', '/wiki']);
    expect(hrefs(BOTTOM_SHEET_LINKS)).toEqual(['/tournaments', '/insights', '/teambuilder', '/players']);
    expect([...hrefs(BOTTOM_BAR_LINKS), ...hrefs(BOTTOM_SHEET_LINKS)].sort()).toEqual(hrefs(ALL_NAV_LINKS).sort());
    for (const href of hrefs(ALL_NAV_LINKS)) expect(href).not.toMatch(/^\/(admin|creator)/);
  });

  it('labels every link through navMessages, in English and German', () => {
    expect(primaryNavLinks(true).map((link) => navMessages.en.links[link.labelKey])).toEqual([
      'Home',
      'Leagues',
      'Tournaments',
      'Replays',
      'Insights',
      'Wiki',
    ]);
    expect(primaryNavLinks(true).map((link) => navMessages.de.links[link.labelKey])).toContain('Turniere');
    expect(navMessages.de.links.more).toBe('Mehr');
  });

  it('uses the approved item icon of each destination', () => {
    expect(Object.fromEntries(ALL_NAV_LINKS.map((link) => [link.labelKey, link.icon]))).toEqual({
      home: 'exp-share',
      leagues: 'poke-ball',
      tournaments: 'kings-rock',
      teams: 'choice-scarf',
      insights: 'scope-lens',
      wiki: 'weakness-policy',
      replays: 'dubious-disc',
      players: 'lucky-egg',
    });
    expect(extensionLinkIcon('/history')).toBe('old-amber');
    expect(extensionLinkIcon('/history/season-1')).toBe('old-amber');
    expect(extensionLinkIcon('/somewhere')).toBe('town-map');
  });
});

describe('isNavPathActive', () => {
  it('lights a link on its page and the pages under it, never on a sibling prefix', () => {
    expect(isNavPathActive('/leagues', '/leagues')).toBe(true);
    expect(isNavPathActive('/leagues/abc/draft', '/leagues')).toBe(true);
    expect(isNavPathActive('/leaguesque', '/leagues')).toBe(false);
    expect(isNavPathActive(null, '/leagues')).toBe(false);
  });

  it('lights Wiki on a Pokémon page and Teams under More on the team library', () => {
    const [, , , , , wiki] = primaryNavLinks(true);
    const teams = MORE_NAV_LINKS[0];
    expect(isNavPathActive('/pokemon/garchomp', wiki.href, wiki.also)).toBe(true);
    expect(isNavPathActive('/teams/library', teams.href, teams.also)).toBe(true);
  });
});

describe('NavBar source contract', () => {
  const source = read('NavBar.tsx');
  const count = (needle: string) => source.split(needle).length - 1;

  it('keeps the nav id and the drawer attributes the route chrome relies on', () => {
    expect(count('id="site-nav"')).toBe(1);
    expect(count('data-navbar-drawer=""')).toBe(2);
    expect(source).toContain('h-16');
  });

  it('switches the link row and the drawer at one breakpoint (lg)', () => {
    expect(count('md:hidden')).toBe(0);
    expect(count('xl:hidden')).toBe(0);
    expect(count('hidden items-center gap-0.5 lg:flex')).toBe(1);
    // Hamburger, drawer backdrop and drawer panel.
    expect(count('lg:hidden')).toBe(3);
  });

  it('shows a signed-in player the row icons from 1152 px, never below, and never hides a label', () => {
    expect(source).toContain("player ? 'hidden min-[1152px]:inline-block' : ''");
    expect(source).not.toContain('xl:inline-block');
    expect(count('iconClassName')).toBe(4);
    const row = source.slice(source.indexOf('lg:flex'), source.indexOf('aria-label="Search"'));
    expect(row).not.toMatch(/label=\{[^}]*hidden/);
  });

  it('carries no Admin or Creator Hub link in the bar: they live in the account menu', () => {
    expect(source).not.toMatch(/['"]\/admin['"]/);
    expect(source).not.toMatch(/['"]\/creator['"]/);
    const menu = read('nav/AccountMenu.tsx');
    expect(menu).toContain('href="/admin"');
    expect(menu).toContain('href="/creator"');
  });

  it('puts the drawer links, Appearance and Language in one scroll region, ahead of the sign-in footer', () => {
    const scroll = source.indexOf('className="min-h-0 flex-1 overflow-y-auto"');
    const links = source.indexOf('<NavMenuLink', scroll);
    const appearance = source.indexOf('<AppearanceSettings name="site-drawer" />');
    const language = source.indexOf('<LanguagePickerSection name="site-drawer-language"');
    const footer = source.indexOf('{/* Auth button */}');
    expect(scroll).toBeGreaterThan(-1);
    expect(links).toBeGreaterThan(scroll);
    expect(appearance).toBeGreaterThan(links);
    expect(language).toBeGreaterThan(appearance);
    expect(footer).toBeGreaterThan(language);
  });

  it('is a labelled modal drawer that closes on Escape and returns focus to the menu button', () => {
    expect(source).toMatch(/role="dialog"/);
    expect(source).toMatch(/aria-modal="true"/);
    expect(source).toContain("aria-label={t('menuLabel')}");
    expect(source).toMatch(/event\.key === 'Escape'\) setMobileOpen\(false\)/);
    expect(source).toContain('closeButtonRef.current?.focus()');
    expect(source).toContain('menuButtonRef.current?.focus()');
  });
});

describe('menus inside #site-nav (D33)', () => {
  const hook = read('nav/use-nav-disclosure.ts');

  it('consumes the panel Escape natively on its wrapper, so the revealed bar stays open', () => {
    expect(hook).toMatch(/wrapper\.addEventListener\('keydown'/);
    expect(hook).toContain('event.stopPropagation()');
  });

  it('closes on a soft navigation: the open state is keyed to the pathname it opened on', () => {
    expect(hook).toContain('const pathname = usePathname();');
    expect(hook).toMatch(/const open = openOn !== null && openOn\.path === pathname;/);
    expect(hook).toMatch(/if \(openOn !== null && openOn\.path !== pathname\) setOpenOn\(null\);/);
    expect(hook).not.toMatch(/useState\(false\)/);
  });

  it('More and the account menu use it and are never portalled', () => {
    for (const file of ['nav/MoreMenu.tsx', 'nav/AccountMenu.tsx', 'nav/use-nav-disclosure.ts', 'PalettePicker.tsx', 'LanguagePicker.tsx']) {
      const source = read(file);
      expect(source, file).not.toContain('createPortal');
      expect(source, file).not.toMatch(/@radix-ui/);
    }
    expect(read('nav/MoreMenu.tsx')).toContain('useNavDisclosure()');
    expect(read('nav/AccountMenu.tsx')).toContain('useNavDisclosure()');
  });
});

describe('bottom tab bar contract (plan §3.1)', () => {
  const bar = read('nav/BottomTabBar.tsx');
  const css = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8');

  it('is not a body > nav, counts as inside the bar for the route reveal, and shows below lg only', () => {
    expect(bar).toMatch(/<div\s+data-site-bottom-bar=""\s+data-navbar-drawer=""/);
    expect(bar).toContain('lg:hidden');
    expect(bar).toContain('if (!session?.player) return null;');
  });

  it('is mounted by the public, player and creator layouts only', () => {
    const app = path.resolve(__dirname, '../../../app');
    const layout = (dir: string) => readFileSync(path.join(app, dir, 'layout.tsx'), 'utf8');
    for (const dir of ['(public)', '(player)', 'creator']) expect(layout(dir), dir).toContain('<BottomTabBar extraLinks={navExtraLinks} />');
    for (const dir of ['(broadcast)', 'auth', 'admin']) expect(layout(dir), dir).not.toContain('BottomTabBar');
  });

  it('pads main by the bar while it is mounted, and never on a draft-room page', () => {
    expect(css).toContain('html:has([data-frozen="draft-room"]) [data-site-bottom-bar] {\n  display: none;');
    expect(css).toMatch(
      /html:not\(\.world-route-live\):not\(:has\(\[data-frozen="draft-room"\]\)\) body:has\(\[data-site-bottom-bar\]\) #main-content \{\s*padding-bottom: calc\(27px \+ 56px \+ env\(safe-area-inset-bottom\)\);/,
    );
  });

  it('parks with the NavBar while a 3D route world is the page', () => {
    expect(css).toMatch(/html\.world-route-live \[data-site-bottom-bar\] \{\s*transform: translate3d\(0, calc\(100% \+ 16px\), 0\);/);
    expect(css).toContain('html:is(.world-route-live, [data-route-handoff])[data-route-nav="open"] [data-site-bottom-bar]');
  });
});
