/**
 * Sprite styles in the shared components (docs/pkmn.md, "Sprite styles"):
 * the viewer's style from SpriteStyleProvider, per-surface overrides, the
 * fallback walk, a fixed box (no layout shift), and the settings / menu options.
 * No NEXT_PUBLIC_SPRITES_URL here, so broadcast resolves to HOME; the bucket
 * case is in sprite-style-broadcast.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { SPRITE_PLACEHOLDER_URL, SPRITE_SOURCES } from '@/lib/pkmn/sprite-styles';
import PokemonSprite from '../PokemonSprite';
import SpriteImg, { nextSpriteIndex } from '../SpriteImg';
import { SpriteStyleProvider } from '../SpriteStyleProvider';
import SpriteStyleOptions from '../SpriteStyleOptions';
import SpriteStyleSettingsForm from '@/app/(player)/dashboard/settings/SpriteStyleSettingsForm';
import BroadcastLayout from '@/app/(broadcast)/layout';
import OverlayPokemonSprite from '@/components/broadcast/shared/OverlayPokemonSprite';
import CrystalXPBar from '@/components/evolution/CrystalXPBar';

const HOME = SPRITE_SOURCES.home;
const SD = SPRITE_SOURCES.showdown;
const srcOf = (html: string) => html.match(/src="([^"]+)"/)?.[1];

describe('fallback walk', () => {
  it('steps to the next candidate and stays on the last (the placeholder never loops)', () => {
    expect(nextSpriteIndex(0, 3)).toBe(1);
    expect(nextSpriteIndex(1, 3)).toBe(2);
    expect(nextSpriteIndex(2, 3)).toBe(2);
    expect(nextSpriteIndex(0, 1)).toBe(0);
  });
});

describe('PokemonSprite', () => {
  it('without a provider renders the site default (broadcast -> HOME without a bucket)', () => {
    expect(srcOf(renderToStaticMarkup(<PokemonSprite name="Garchomp" />))).toBe(`${HOME}/normal/garchomp.png`);
  });

  it('follows the viewer preference from the provider', () => {
    const pixel = renderToStaticMarkup(
      <SpriteStyleProvider initialPreference="pixel">
        <PokemonSprite name="Ho-Oh" />
      </SpriteStyleProvider>,
    );
    expect(srcOf(pixel)).toBe(`${SD}/gen5/hooh.png`);
    const animated = renderToStaticMarkup(
      <SpriteStyleProvider initialPreference="animated">
        <PokemonSprite name="Rotom-Wash" shiny />
      </SpriteStyleProvider>,
    );
    expect(srcOf(animated)).toBe(`${SD}/ani-shiny/rotom-wash.gif`);
  });

  it('a surface override beats the viewer preference', () => {
    const html = renderToStaticMarkup(
      <SpriteStyleProvider initialPreference="pixel">
        <PokemonSprite name="Garchomp" spriteStyle="home" />
      </SpriteStyleProvider>,
    );
    expect(srcOf(html)).toBe(`${HOME}/normal/garchomp.png`);
  });

  it('keeps a fixed box whatever the source: width, height and object-fit contain', () => {
    const html = renderToStaticMarkup(
      <SpriteStyleProvider initialPreference="animated">
        <PokemonSprite name="Garchomp" size={56} />
      </SpriteStyleProvider>,
    );
    expect(html).toContain('width="56"');
    expect(html).toContain('height="56"');
    expect(html).toMatch(/object-fit:\s*contain/);
    expect(html).not.toContain('/_next/image');
  });

  it('an empty name renders the placeholder', () => {
    expect(srcOf(renderToStaticMarkup(<PokemonSprite name="" />))).toBe(SPRITE_PLACEHOLDER_URL);
  });

  it('localizes only the alt text', () => {
    const html = renderWithI18n(<PokemonSprite name="Charizard" />, { locale: 'de' });
    expect(html).toContain('alt="Glurak"');
    expect(srcOf(html)).toBe(`${HOME}/normal/charizard.png`);
  });
});

describe('SpriteImg', () => {
  it('is a plain img sized by the caller, in the viewer style', () => {
    const html = renderToStaticMarkup(
      <SpriteStyleProvider initialPreference="pixel">
        <SpriteImg name="Garchomp" alt="" className="w-10 h-10" />
      </SpriteStyleProvider>,
    );
    expect(html).toContain('<img ');
    expect(html).toContain('class="w-10 h-10"');
    expect(srcOf(html)).toBe(`${SD}/gen5/garchomp.png`);
  });

  it('overlays pin the site default regardless of the viewer cookie', () => {
    const html = renderToStaticMarkup(
      <SpriteStyleProvider initialPreference="pixel">
        <SpriteImg name="Garchomp" alt="" spriteStyle="broadcast" />
      </SpriteStyleProvider>,
    );
    expect(srcOf(html)).toBe(`${HOME}/normal/garchomp.png`);
  });
});

describe('broadcast overlays ignore the viewer cookie', () => {
  // The root layout's provider carries the OBS browser's plc_sprite_style cookie ('pixel' here).
  it('OverlayPokemonSprite pins the site default even under a pixel viewer provider', () => {
    const html = renderToStaticMarkup(
      <SpriteStyleProvider initialPreference="pixel">
        <OverlayPokemonSprite pokemon="Garchomp" />
      </SpriteStyleProvider>,
    );
    expect(srcOf(html)).toBe(`${HOME}/normal/garchomp.png`);
  });

  it('the (broadcast) layout resets every sprite inside it to the site default', () => {
    const html = renderToStaticMarkup(
      <SpriteStyleProvider initialPreference="pixel">
        <BroadcastLayout>
          <PokemonSprite name="Garchomp" />
          <SpriteImg name="Pikachu" alt="" />
        </BroadcastLayout>
      </SpriteStyleProvider>,
    );
    expect(html).toContain(`src="${HOME}/normal/garchomp.png"`);
    expect(html).toContain(`src="${HOME}/normal/pikachu.png"`);
    expect(html).not.toContain(`${SD}/gen5/`);
  });
});

describe('CrystalXPBar (evolution replay)', () => {
  it('renders the species through SpriteImg in the viewer style (with the onError fallback chain)', () => {
    const html = renderWithI18n(
      <SpriteStyleProvider initialPreference="pixel">
        <CrystalXPBar current={3} max={10} label="Gible" spriteSpecies="Gible" nextSpriteSpecies="Gabite" />
      </SpriteStyleProvider>,
    );
    expect(srcOf(html)).toBe(`${SD}/gen5/gible.png`);
    expect(html).toContain('width="32"');
  });
});

describe('SpriteStyleOptions', () => {
  it('cards: five radios with live previews in each style, the current one checked', () => {
    const html = renderWithI18n(
      <SpriteStyleOptions name="t" variant="cards" value="pixel" onChange={() => {}} />,
    );
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toMatch(/checked="" value="pixel"/);
    expect(html).toContain(`${SD}/gen5/charizard.png`);
    expect(html).toContain(`${SD}/ani/charizard.gif`);
    expect(html).toContain(`${HOME}/normal/charizard.png`);
    expect(html).toContain('Follows this site’s default: Broadcast renders.');
    // No bucket configured: the broadcast option says what is shown instead.
    expect(html).toContain('HOME renders are shown instead');
    expect(html).toContain('aria-label="Pixel preview: Charizard"');
  });

  it('compact (menu): no previews, German copy', () => {
    const html = renderWithI18n(
      <SpriteStyleOptions name="m" variant="compact" value="site" onChange={() => {}} />,
      { locale: 'de' },
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('Pokémon-Sprites');
    expect(html).toContain('Standard der Seite');
    expect(html).toMatch(/checked="" value="site"/);
  });
});

describe('SpriteStyleSettingsForm', () => {
  it('discloses a failed read instead of pretending a stored value', () => {
    const html = renderWithI18n(<SpriteStyleSettingsForm stored={null} readFailed />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('could not be loaded');
    expect(html).toContain('Sprite style');
  });

  it('renders the cookie preference until the account value is synced', () => {
    const html = renderWithI18n(
      <SpriteStyleProvider initialPreference="home">
        <SpriteStyleSettingsForm stored="home" readFailed={false} />
      </SpriteStyleProvider>,
    );
    expect(html).toMatch(/checked="" value="home"/);
    expect(html).not.toContain('role="alert"');
  });
});
