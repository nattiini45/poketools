import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import PalettePicker, { PaletteOptions, PalettePickerSection } from '../PalettePicker';

const noop = () => {};
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe('PaletteOptions', () => {
  it('renders one named radio group with the four palettes, the current one checked', () => {
    const html = renderToStaticMarkup(<PaletteOptions value="sakura" onSelect={noop} name="site-palette" />);

    expect(count(html, /<fieldset/g)).toBe(1);
    expect(html).toMatch(/<legend[^>]*>Color scheme<\/legend>/);
    expect(count(html, /type="radio"/g)).toBe(4);
    expect(count(html, /name="site-palette"/g)).toBe(4);
    expect(count(html, /checked=""/g)).toBe(1);
    const checkedInput = html.match(/<input[^>]*checked=""[^>]*>/)?.[0] ?? '';
    expect(checkedInput).toContain('value="sakura"');
    for (const label of ['Plaza', 'Sakura Park', 'Mountain Pass', 'Skyisle']) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it('paints swatches from the palette cores, hidden from assistive tech, with no hex', () => {
    const html = renderToStaticMarkup(<PaletteOptions value="plaza" onSelect={noop} name="p" />);

    for (const id of ['plaza', 'sakura', 'mountain', 'clouds']) {
      for (const role of ['ground', 'surface', 'accent']) {
        expect(html).toContain(`background:var(--palette-${id}-${role})`);
      }
    }
    // Every swatch wrapper (the ringed disc) is aria-hidden.
    const swatches = html.match(/<span[^>]*ring-poke-border-strong[^>]*>/g) ?? [];
    expect(swatches).toHaveLength(4);
    for (const swatch of swatches) expect(swatch).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('speaks German under a German provider', () => {
    const html = renderWithI18n(<PaletteOptions value="plaza" onSelect={noop} name="p" />, { locale: 'de' });
    expect(html).toMatch(/<legend[^>]*>Farbschema<\/legend>/);
    for (const label of ['Plaza', 'Sakura-Park', 'Bergpass', 'Himmelsinsel']) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('>Warmer Sand · Standard<');
    expect(renderWithI18n(<PalettePicker />, { locale: 'de' })).toContain('aria-label="Farbschema"');
  });

  it('checks nothing before hydration (value null)', () => {
    const html = renderToStaticMarkup(<PaletteOptions value={null} onSelect={noop} name="p" />);
    expect(count(html, /type="radio"/g)).toBe(4);
    expect(html).not.toContain('checked=""');
  });

  it('keeps two instances as two radio groups', () => {
    const html = renderToStaticMarkup(
      <>
        <PaletteOptions value="clouds" onSelect={noop} name="site-palette" />
        <PaletteOptions value="clouds" onSelect={noop} name="site-palette-mobile" />
      </>,
    );
    expect(count(html, /name="site-palette"/g)).toBe(4);
    expect(count(html, /name="site-palette-mobile"/g)).toBe(4);
    expect(count(html, /checked=""/g)).toBe(2);
  });

  it('describes each option in text-secondary, never text-muted (contrast on the checked row)', () => {
    const html = renderToStaticMarkup(<PaletteOptions value="plaza" onSelect={noop} name="p" />);
    expect(html).toMatch(/<span class="[^"]*text-poke-text-secondary[^"]*">Warm sand · default<\/span>/);
    expect(html).not.toContain('text-poke-text-muted');
  });
});

describe('PalettePicker (server render)', () => {
  it('renders the closed trigger only, named without a palette (server snapshot is null)', () => {
    const html = renderToStaticMarkup(<PalettePicker />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="[^"]+"/);
    expect(html).toContain('aria-label="Color scheme"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('<fieldset');
    expect(html).not.toContain('type="radio"');
  });

  it('the mobile section renders its own group with nothing checked on the server', () => {
    const html = renderToStaticMarkup(<PalettePickerSection />);
    expect(count(html, /name="site-palette-mobile"/g)).toBe(4);
    expect(html).not.toContain('checked=""');
  });
});

describe('PalettePicker source contract', () => {
  const source = readFileSync(path.resolve(__dirname, '../PalettePicker.tsx'), 'utf8');

  it('consumes the panel Escape natively on its wrapper, so the D33 bar stays open (C6)', () => {
    expect(source).toMatch(/wrapper\.addEventListener\('keydown'/);
    expect(source).toContain('event.stopPropagation()');
    expect(source).not.toMatch(/onKeyDown=\{/);
  });

  it('is never portalled (the panel stays inside #site-nav)', () => {
    expect(source).not.toContain('createPortal');
    expect(source).not.toMatch(/@radix-ui/);
  });
});
