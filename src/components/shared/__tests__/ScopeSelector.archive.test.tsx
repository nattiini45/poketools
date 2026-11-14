/** @vitest-environment jsdom */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScopeSelector from '../ScopeSelector';
import type { HistoricalCompetitionOption } from '@/lib/pack-extensions/historical-statistics-types';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/insights',
  useSearchParams: () => new URLSearchParams('scope=archive&id=sky-cup&tab=usage&history=0&custom=keep'),
}));

const archiveOptions: HistoricalCompetitionOption[] = [
  { id: 'sky-cup', name: 'Sky Cup', href: '/archive/sky-cup', parentId: null, kind: 'cup', year: 2020, seasonLabel: null },
  { id: 'moon-cup', name: 'Moon Cup', href: '/archive/moon-cup', parentId: null, kind: 'cup', year: 2021, seasonLabel: null },
];

describe('archive scope selector', () => {
  it('hides archive scope for existing callers and preserves global-only behavior', () => {
    render(<ScopeSelector scope={{ type: 'global' }} leagues={[]} tournaments={[]} globalOnly archiveOptions={archiveOptions} />);
    expect(screen.queryByRole('option', { name: 'Archive' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveProperty('disabled', true);
  });

  it('keeps query parameters and removes the id on global', async () => {
    const user = userEvent.setup();
    render(<ScopeSelector scope={{ type: 'archive', id: 'sky-cup' }} leagues={[]} tournaments={[]} archiveOptions={archiveOptions} />);
    expect(screen.getByRole('combobox', { name: 'Search archived competitions' })).toHaveProperty('value', 'Sky Cup');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scope' }), 'global');
    const url = new URL(push.mock.calls.at(-1)?.[0], 'https://example.test');
    expect(url.searchParams.get('scope')).toBe('global');
    expect(url.searchParams.has('id')).toBe(false);
    expect(url.searchParams.get('tab')).toBe('usage');
    expect(url.searchParams.get('history')).toBe('0');
    expect(url.searchParams.get('custom')).toBe('keep');
  });

  it('supports keyboard searching and selecting an archived competition', async () => {
    const user = userEvent.setup();
    render(<ScopeSelector scope={{ type: 'archive', id: 'sky-cup' }} leagues={[]} tournaments={[]} archiveOptions={archiveOptions} />);
    const picker = screen.getByRole('combobox', { name: 'Search archived competitions' });
    await user.click(picker);
    await user.clear(picker);
    await user.type(picker, 'Moon');
    await user.keyboard('{ArrowDown}{Enter}');
    const url = new URL(push.mock.calls.at(-1)?.[0], 'https://example.test');
    expect(url.searchParams.get('scope')).toBe('archive');
    expect(url.searchParams.get('id')).toBe('moon-cup');
    expect(url.searchParams.get('history')).toBe('0');
  });
});
