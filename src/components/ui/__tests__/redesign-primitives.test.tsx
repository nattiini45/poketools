/** @vitest-environment jsdom */
/**
 * Direction B primitives (redesign F4): ItemIcon draws only approved icons at whole multiples of 24 px and stays
 * decorative; SkewPlate keeps its label upright and reserves the heavier weight so the active label never resizes
 * the plate; SkewChip carries its tone. The skew lives on the plate span only.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ItemIcon from '../ItemIcon';
import SkewChip from '../SkewChip';
import SkewPlate from '../SkewPlate';
import Button from '../Button';
import { ITEM_ICON_IDS, itemIconSource } from '@/lib/pkmn/item-icons';

describe('ItemIcon', () => {
  it('renders a per-file icon as a decorative pixelated image at the asked size', () => {
    const { container } = render(<ItemIcon item="poke-ball" size={48} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://play.pokemonshowdown.com/sprites/itemicons/poke-ball.png');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('width')).toBe('48');
    expect(img?.className).toContain('[image-rendering:pixelated]');
  });

  it('draws a sheet icon from its pinned cell, scaled by a whole factor', () => {
    const { container } = render(<ItemIcon item="ability-shield" size={72} />);
    const outer = container.firstElementChild as HTMLElement;
    const cell = outer.firstElementChild as HTMLElement;
    expect(outer.getAttribute('aria-hidden')).toBe('true');
    expect(outer.style.width).toBe('72px');
    expect(cell.style.background).toContain('-240px -1104px');
    expect(cell.style.transform).toBe('scale(3)');
  });

  it('maps every approved icon to one source', () => {
    expect(new Set(ITEM_ICON_IDS).size).toBe(ITEM_ICON_IDS.length);
    for (const id of ITEM_ICON_IDS) expect(itemIconSource(id).url).toMatch(/^https:\/\/play\.pokemonshowdown\.com\/sprites\/itemicons/);
  });
});

describe('SkewPlate', () => {
  it('keeps one readable label and reserves the heavy weight for it', () => {
    const { container } = render(
      <button type="button">
        <SkewPlate variant="tab">Standings</SkewPlate>
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Standings' })).toBeTruthy();
    const ghost = container.querySelector('[aria-hidden="true"].invisible');
    expect(ghost?.textContent).toBe('Standings');
    expect(ghost?.className).toContain('font-[550]');
  });

  it('draws the nav plate only for the active item, and the tab underside only for the active tab', () => {
    const { container, rerender } = render(<SkewPlate variant="nav">Leagues</SkewPlate>);
    expect(container.querySelector('.skew-plate-bg')).toBeNull();
    rerender(<SkewPlate variant="nav" active>Leagues</SkewPlate>);
    expect(container.querySelector('.skew-plate-bg')?.className).toContain('bg-tier-1');
    rerender(<SkewPlate variant="tab">Rules</SkewPlate>);
    expect(container.querySelector('.skew-plate-underside')).toBeNull();
    rerender(<SkewPlate variant="tab" active>Rules</SkewPlate>);
    expect(container.querySelector('.skew-plate-underside')).not.toBeNull();
  });

  it('fills a rank plate with its tier and dark ink', () => {
    const { container } = render(<SkewPlate variant="rank" tier={3}>3</SkewPlate>);
    expect(container.querySelector('.skew-plate-bg')?.className).toContain('bg-tier-3');
    expect((container.firstElementChild as HTMLElement).className).toContain('text-tier-ink');
  });
});

describe('SkewChip', () => {
  it('fills the plate with its tone and inks the label', () => {
    const { container } = render(<SkewChip tone="loss">L</SkewChip>);
    expect(container.querySelector('.skew-plate-bg')?.className).toContain('bg-loss-bg');
    expect((container.firstElementChild as HTMLElement).className).toContain('text-loss');
  });
});

describe('Button', () => {
  it('keeps an icon and its label on one row inside the @fluid label span', () => {
    render(
      <Button variant="secondary">
        <svg data-testid="icon" aria-hidden="true" />
        Add stage
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Add stage' });
    expect(button.className).toContain('[&>span>span]:inline-flex');
    expect(screen.getByTestId('icon').parentElement?.textContent).toBe('Add stage');
  });

  it('leaves a text-only label to the @fluid text trim', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).className).not.toContain('[&>span>span]:inline-flex');
  });
});
