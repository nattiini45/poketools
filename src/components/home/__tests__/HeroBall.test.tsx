/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import HeroBall from '../HeroBall';

const NAMES = ['Poké Ball', 'Great Ball', 'Ultra Ball', 'Master Ball'];

function ball(locale: 'en' | 'de' = 'en') {
  render(withI18n(<HeroBall className="h-20 w-20" />, { locale }));
  return screen.getByRole('button');
}

function designOf(button: HTMLElement) {
  return NAMES.find((name) => button.getAttribute('aria-label')?.startsWith(name));
}

describe('HeroBall', () => {
  it('starts as the Poké Ball and names its design for assistive tech', () => {
    const button = ball();
    expect(designOf(button)).toBe('Poké Ball');
    expect(button.getAttribute('aria-label')).toBe('Poké Ball — change design');
  });

  it('advances one design per mouse entry and wraps back to the Poké Ball', () => {
    const button = ball();
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 4; i += 1) {
      fireEvent.pointerEnter(button, { pointerType: 'mouse' });
      seen.push(designOf(button));
    }
    expect(seen).toEqual(['Great Ball', 'Ultra Ball', 'Master Ball', 'Poké Ball']);
  });

  it('does not step a second time when the mouse that entered also clicks', () => {
    const button = ball();
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    fireEvent.pointerDown(button, { pointerType: 'mouse' });
    fireEvent.click(button, { detail: 1 });
    expect(designOf(button)).toBe('Great Ball');
  });

  it('cycles on a touch tap, where there is no hover to enter with', () => {
    const button = ball();
    fireEvent.pointerEnter(button, { pointerType: 'touch' });
    expect(designOf(button)).toBe('Poké Ball');
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.click(button, { detail: 1 });
    expect(designOf(button)).toBe('Great Ball');
  });

  it('cycles on Enter and Space but not on focus alone', async () => {
    const user = userEvent.setup();
    const button = ball();
    await user.tab();
    expect(button).toBe(document.activeElement);
    expect(designOf(button)).toBe('Poké Ball');
    await user.keyboard('{Enter}');
    expect(designOf(button)).toBe('Great Ball');
    await user.keyboard(' ');
    expect(designOf(button)).toBe('Ultra Ball');
  });

  it('stays closed: no split halves and no hover-driven transform classes', () => {
    const button = ball();
    const markup = button.outerHTML;
    expect(markup).not.toContain('group-hover');
    expect(markup).not.toMatch(/translate-y|-rotate-6|rotate-6/);
    expect(button.querySelectorAll('svg')).toHaveLength(1);
  });

  it('draws every design from inline vector art with no image request', () => {
    const button = ball();
    for (let i = 0; i < 4; i += 1) {
      expect(button.querySelector('img')).toBeNull();
      expect(button.innerHTML).not.toMatch(/https?:|url\(["']?(?!#)/);
      fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    }
  });

  it('renders the German design names', () => {
    const button = ball('de');
    expect(button.getAttribute('aria-label')).toBe('Pokéball — Design wechseln');
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    expect(button.getAttribute('aria-label')).toBe('Superball — Design wechseln');
  });
});
