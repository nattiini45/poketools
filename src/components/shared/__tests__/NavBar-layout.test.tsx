import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: { image: null },
      player: {
        playerId: 'p1',
        name: 'Fixture League Admin',
        avatarUrl: null,
        isAdmin: true,
        isCreator: true,
        isResourceAdmin: false,
      },
    },
  }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../DiscordLoginButton', () => ({ default: () => <span data-stub="auth" /> }));
vi.mock('../ThemeToggle', () => ({ default: () => <span data-stub="theme" /> }));
vi.mock('../PalettePicker', () => ({
  default: () => <span data-stub="palette" />,
  PalettePickerSection: () => <span data-stub="palette-section" />,
}));
vi.mock('../LanguagePicker', () => ({
  default: () => <span data-stub="language" />,
  LanguagePickerSection: () => <span data-stub="language-section" />,
}));
vi.mock('../PwaInstallPrompt', () => ({ default: () => <span data-stub="pwa" /> }));
vi.mock('../PlayerAvatar', () => ({
  default: ({ className }: { className?: string }) => <span data-stub="avatar" className={className} />,
}));

import NavBar, { NavLink } from '../NavBar';

/** Class list of the first element whose opening tag matches `pattern`. */
function classesOf(html: string, pattern: RegExp): string[] {
  const tag = html.match(pattern)?.[0] ?? '';
  const classes = tag.match(/class="([^"]*)"/)?.[1] ?? '';
  return classes.split(/\s+/).filter(Boolean);
}

describe('NavBar layout (fits every width)', () => {
  const html = renderWithI18n(<NavBar />);

  it('the menu button reports its state and names the drawer it opens', () => {
    const button = html.match(/<button[^>]*aria-controls="navbar-drawer"[^>]*>/)?.[0] ?? '';
    expect(button).toContain('aria-expanded="false"');
  });

  it('truncates a long display name and exposes it as a tooltip', () => {
    const name = classesOf(html, /<span[^>]*>(?=Fixture League Admin<\/span>)/);
    expect(name).toContain('truncate');
    expect(name).toContain('max-w-[10rem]');

    const profile = html.match(/<a[^>]*href="\/players\/p1"[^>]*>/)?.[0] ?? '';
    expect(profile).toContain('title="Fixture League Admin"');
    expect(classesOf(profile, /^.*$/)).toContain('min-w-0');

    expect(classesOf(html, /<span[^>]*>(?=View public profile<\/span>)/)).toContain('truncate');
    expect(classesOf(html, /<span data-stub="avatar"[^>]*>/)).toContain('shrink-0');
  });

  it('keeps Sign Out on one line', () => {
    const wrapper = classesOf(html, /<div[^>]*>(?=<span data-stub="auth"><\/span>)/);
    expect(wrapper).toContain('shrink-0');
    expect(wrapper).toContain('whitespace-nowrap');
  });

  it('gives the bar row a gap and shrink rules so nothing overflows', () => {
    const row = classesOf(html, /<div class="flex h-16[^"]*"[^>]*>/);
    expect(row).toContain('justify-between');
    expect(row).toContain('gap-3');
    expect(classesOf(html, /<div class="flex shrink-0 items-center gap-1"[^>]*>/)).toContain('shrink-0');
    expect(classesOf(html, /<div class="flex min-w-0 items-center[^"]*"[^>]*>/)).toContain('min-w-0');
  });

  it('switches the desktop links and the hamburger at the same breakpoint', () => {
    const links = classesOf(html, /<div class="hidden xl:flex[^"]*"[^>]*>/);
    expect(links).toContain('hidden');
    expect(links).toContain('xl:flex');

    const toggle = classesOf(html, /<button[^>]*aria-label="Toggle menu"[^>]*>/);
    expect(toggle).toContain('xl:hidden');
    expect(toggle).toContain('shrink-0');

    for (const list of [links, toggle]) {
      expect(list.filter((c) => c.startsWith('md:') && /hidden|flex|block/.test(c))).toEqual([]);
    }
  });

  it('renders the desktop links dense', () => {
    const row = html.slice(html.indexOf('hidden xl:flex'), html.indexOf('data-stub="language"'));
    const links = row.match(/<a [^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(9);
    for (const link of links.filter((l) => !l.includes('/players/'))) {
      expect(link).toContain('px-2');
    }
  });

  it('renders in German with the same truncation rules', () => {
    const de = renderWithI18n(<NavBar />, { locale: 'de' });
    expect(de).toContain('Öffentliches Profil ansehen');
    const name = classesOf(de, /<span[^>]*>(?=Fixture League Admin<\/span>)/);
    expect(name).toContain('truncate');
    expect(name).toContain('max-w-[10rem]');
  });
});

describe('NavLink padding', () => {
  it('uses px-2 when dense and px-3 by default, and never wraps its label', () => {
    const dense = renderToStaticMarkup(<NavLink href="/x" label="X" active={false} dense />);
    expect(dense).toContain('px-2');
    expect(dense).not.toContain('px-3');
    expect(dense).toContain('whitespace-nowrap');

    const regular = renderToStaticMarkup(<NavLink href="/x" label="X" active={false} />);
    expect(regular).toContain('px-3');
    expect(regular).not.toContain('px-2');
  });
});
