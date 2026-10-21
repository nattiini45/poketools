import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { publicNavLinks } from '../NavBar';
import { navMessages } from '@/i18n/messages/nav';

describe('publicNavLinks', () => {
  it('includes the Replays destination in the public navigation', () => {
    expect(publicNavLinks).toContainEqual({ href: '/replays', labelKey: 'replays' });
  });

  it('labels every public link through navMessages (English source unchanged)', () => {
    const labels = publicNavLinks.map((link) => navMessages.en.links[link.labelKey]);
    expect(labels).toEqual(['Tournaments', 'Leagues', 'Replays', 'Insights', 'Wiki', 'Players']);
    expect(publicNavLinks.map((link) => navMessages.de.links[link.labelKey])).toContain('Turniere');
  });
});

describe('NavBar language picker wiring (i18n-core §2.1)', () => {
  const source = readFileSync(path.resolve(__dirname, '../NavBar.tsx'), 'utf8');

  it('renders the desktop language picker immediately before the palette picker', () => {
    const language = source.indexOf('<LanguagePicker />');
    const palette = source.indexOf('<PalettePicker />');
    expect(language).toBeGreaterThan(-1);
    expect(palette).toBeGreaterThan(language);
    expect(source.slice(language + '<LanguagePicker />'.length, palette).trim()).toBe('');
  });

  it('puts the drawer language section right after the palette section, inside the scroll region', () => {
    const palette = source.indexOf('<PalettePickerSection />');
    const language = source.indexOf('<LanguagePickerSection />');
    const footer = source.indexOf('{/* Auth button */}');
    expect(language).toBeGreaterThan(palette);
    expect(footer).toBeGreaterThan(language);
    expect(source.slice(palette, language)).not.toContain('</div>');
  });
});

describe('NavBar site palette wiring', () => {
  const source = readFileSync(path.resolve(__dirname, '../NavBar.tsx'), 'utf8');

  it('imports the palette picker and its drawer section', () => {
    expect(source).toMatch(/import PalettePicker, \{ PalettePickerSection \} from '\.\/PalettePicker';/);
  });

  it('renders the desktop picker right before the light/dark toggle', () => {
    const picker = source.indexOf('<PalettePicker />');
    const toggle = source.indexOf('<ThemeToggle />');
    expect(picker).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(picker);
    expect(source.slice(picker + '<PalettePicker />'.length, toggle).trim()).toBe('');
  });

  it('puts the drawer palette section inside the scroll region, after the links and before the auth footer', () => {
    const scroll = source.indexOf('className="flex-1 min-h-0 overflow-y-auto"');
    const links = source.indexOf('<MobileNavLink', scroll);
    const section = source.indexOf('<PalettePickerSection />');
    const footer = source.indexOf('{/* Auth button */}');
    expect(scroll).toBeGreaterThan(-1);
    expect(links).toBeGreaterThan(scroll);
    expect(section).toBeGreaterThan(links);
    expect(footer).toBeGreaterThan(section);
    // Still inside the scroll element: no <div> closes between its start and the section
    // (the link list closes with </nav>), and the scroll element closes before the footer.
    expect(source.slice(scroll, section)).not.toContain('</div>');
    expect(source.slice(section, footer)).toContain('</div>');
    // The link list itself no longer scrolls on its own (one scroll region).
    expect(source).not.toMatch(/<nav className="[^"]*overflow-y-auto/);
  });
});
