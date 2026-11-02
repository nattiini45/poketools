/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';

const back = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ back }) }));

import ErrorState from '../ErrorState';

function renderState(props: Partial<Parameters<typeof ErrorState>[0]> = {}, locale: 'en' | 'de' = 'en') {
  const onRetry = vi.fn();
  render(
    withI18n(
      <ErrorState title="Broke" description="It broke." retryLabel="Retry now" backLabel="Back out" onRetry={onRetry} {...props} />,
      { locale },
    ),
  );
  return { onRetry };
}

describe('ErrorState', () => {
  it('renders the title and description, with the emoji hidden from assistive tech', () => {
    renderState();
    expect(screen.getByRole('heading', { name: 'Broke' })).toBeTruthy();
    expect(screen.getByText('It broke.')).toBeTruthy();
    expect(document.querySelector('[aria-hidden="true"]')?.textContent).toBe('😵');
  });

  it('retries and goes back from the two buttons', async () => {
    const { onRetry } = renderState();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry now' }));
    await user.click(screen.getByRole('button', { name: 'Back out' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('shows the digest as a reference line in the viewer language, only when there is one', () => {
    renderState({ digest: 'abc123' }, 'de');
    expect(screen.getByText(/abc123/).textContent).toMatch(/^Referenz/);
  });

  it('shows no reference line without a digest', () => {
    renderState();
    expect(screen.queryByText(/Reference/)).toBeNull();
  });

  it('shows the optional detail apart from the description', () => {
    renderState({ detail: 'raw text' });
    expect(screen.getByText('raw text')).toBeTruthy();
    expect(screen.getByText('It broke.')).toBeTruthy();
  });
});
