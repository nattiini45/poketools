/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalError from '../global-error';

const RAW = 'internal detail: Proxy failed at /srv/app';

function renderBoundary(error: Error & { digest?: string }, reset = () => {}) {
  // The boundary renders its own <html>/<body>; React warns about that inside a test container.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return render(<GlobalError error={error} reset={reset} />);
}

describe('global-error', () => {
  beforeEach(() => {
    document.cookie = 'plc_locale=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });
  afterEach(() => {
    document.cookie = 'plc_locale=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    vi.restoreAllMocks();
  });

  it('shows the English fallback, never the raw message, with the digest reference', () => {
    renderBoundary(Object.assign(new Error(RAW), { digest: 'abc123' }));
    expect(screen.getByText('A critical error occurred.')).toBeTruthy();
    expect(screen.getByText('Reference: abc123')).toBeTruthy();
    expect(document.body.textContent).not.toContain('internal detail');
  });

  it('shows the German fallback and reference under the locale cookie', () => {
    document.cookie = 'plc_locale=de; path=/';
    renderBoundary(Object.assign(new Error(RAW), { digest: 'abc123' }));
    expect(screen.getByText('Ein schwerwiegender Fehler ist aufgetreten.')).toBeTruthy();
    expect(screen.getByText('Referenz: abc123')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('internal detail');
  });

  it('has no reference line without a digest, and retry calls reset', async () => {
    const reset = vi.fn();
    renderBoundary(new Error(RAW), reset);
    expect(document.body.textContent).not.toContain('Reference');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
