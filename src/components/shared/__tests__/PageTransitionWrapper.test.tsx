/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/admin/leagues' }));

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

import PageTransitionWrapper from '../PageTransitionWrapper';

function page(title: string) {
  return (
    <PageTransitionWrapper>
      <h1>{title}</h1>
      <button type="button">{title} action</button>
    </PageTransitionWrapper>
  );
}

describe('PageTransitionWrapper', () => {
  it('leaves the page it shows untouched', () => {
    nav.pathname = '/admin/leagues';
    render(page('Leagues'));
    const heading = screen.getByRole('heading', { level: 1, name: 'Leagues' });
    expect(heading.parentElement?.hasAttribute('inert')).toBe(false);
    expect(heading.parentElement?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('takes the leaving copy out of the accessibility tree while the arriving page is mounted', async () => {
    nav.pathname = '/admin/leagues';
    const { rerender } = render(page('Leagues'));
    nav.pathname = '/admin/tournaments';
    rerender(page('Tournaments'));

    const headings = document.querySelectorAll('h1');
    expect(headings).toHaveLength(2);
    const leaving = [...headings].find((h) => h.textContent === 'Leagues')?.parentElement;
    const arriving = [...headings].find((h) => h.textContent === 'Tournaments')?.parentElement;
    expect(leaving?.hasAttribute('inert')).toBe(true);
    expect(leaving?.getAttribute('aria-hidden')).toBe('true');
    expect(arriving?.hasAttribute('inert')).toBe(false);
    expect(arriving?.hasAttribute('aria-hidden')).toBe(false);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Tournaments' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);

    await waitFor(() => expect(document.querySelectorAll('h1')).toHaveLength(1));
  });
});
