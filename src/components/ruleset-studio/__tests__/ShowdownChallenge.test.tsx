/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import ShowdownChallenge from '../ShowdownChallenge';

const CHALLENGE = 'gen9nationaldexag @@@ -All Pokemon, +pokemon:pikachu';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ShowdownChallenge', () => {
  it('copies the challenge, says so, and clears the status again', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    render(withI18n(<ShowdownChallenge value={CHALLENGE} />));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy challenge rules' }));
    });
    expect(writeText).toHaveBeenCalledWith(CHALLENGE);
    expect(screen.getByRole('status').textContent).toBe('Copied.');
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('reports a refused or missing clipboard instead of throwing, and selects the text for a manual copy', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError');
    });
    render(withI18n(<ShowdownChallenge value={CHALLENGE} />));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy challenge rules' }));
    });
    expect(screen.getByRole('status').textContent).toBe('Copying failed. Select the text and copy it by hand.');
    expect(console.warn).toHaveBeenCalled();

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy challenge rules' }));
    });
    expect(screen.getByRole('status').textContent).toBe('Copying failed. Select the text and copy it by hand.');
  });

  it('states what the challenge cannot carry, uses the requested heading level and a unique heading id', () => {
    render(withI18n(<><ShowdownChallenge value={CHALLENGE} headingLevel={2} /><ShowdownChallenge value={CHALLENGE} /></>));
    expect(screen.getAllByText(/cannot carry level rules/)).toHaveLength(2);
    const headings = screen.getAllByText('Pokémon Showdown challenge');
    expect(headings.map((heading) => heading.tagName)).toEqual(['H2', 'H3']);
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(2);
    for (const heading of headings) expect(heading.closest('section')?.getAttribute('aria-labelledby')).toBe(heading.id);
  });
});
