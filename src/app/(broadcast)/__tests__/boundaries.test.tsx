/** @vitest-environment jsdom */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BroadcastLayout, { BROADCAST_TRANSPARENCY_CSS } from '../layout';
import BroadcastLoading from '../loading';
import BroadcastNotFound from '../not-found';
import BroadcastOverlayError from '../error';

const groupDir = path.resolve(__dirname, '..');

describe('(broadcast) route group', () => {
  it.each(['layout.tsx', 'loading.tsx', 'error.tsx', 'not-found.tsx'])('has %s', (file) => {
    expect(existsSync(path.join(groupDir, file))).toBe(true);
  });

  it('renders the transparency rule as a server-rendered <style> with no :has() dependency', () => {
    const html = renderToStaticMarkup(
      <BroadcastLayout>
        <p>overlay</p>
      </BroadcastLayout>,
    );
    expect(BROADCAST_TRANSPARENCY_CSS).toBe('html,body{background:transparent!important}');
    expect(html).toContain(`<style>${BROADCAST_TRANSPARENCY_CSS}</style>`);
    expect(html).toContain('overlay');
    expect(readFileSync(path.join(groupDir, 'layout.tsx'), 'utf8').replace(/\/\*\*[\s\S]*?\*\//g, '')).not.toContain(':has(');
  });

  it('shows nothing while loading and when an overlay is not found', () => {
    expect(renderToStaticMarkup(<BroadcastLoading />)).toBe('');
    expect(renderToStaticMarkup(<BroadcastNotFound />)).toBe('');
  });
});

describe('(broadcast) error boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing, never the raw message, and logs the error', () => {
    const error = Object.assign(new Error('internal detail: Proxy failed'), { digest: 'abc' });
    const { container, unmount } = render(<BroadcastOverlayError error={error} reset={() => {}} />);
    expect(container.innerHTML).toBe('');
    expect(container.textContent).not.toContain('internal detail');
    expect(console.error).toHaveBeenCalled();
    unmount();
  });

  it('retries by itself on a growing, capped delay and stops when unmounted', () => {
    const reset = vi.fn();
    const error = new Error('boom');
    const delays: number[] = [];
    // The tracker is module state; a quiet spell makes the earlier test's failure irrelevant.
    vi.advanceTimersByTime(10 * 60_000);
    // Each failed retry remounts the fallback, so the schedule must survive a remount.
    for (let i = 0; i < 7; i++) {
      const { unmount } = render(<BroadcastOverlayError error={error} reset={reset} />);
      let waited = 0;
      while (reset.mock.calls.length === i && waited < 40_000) {
        act(() => {
          vi.advanceTimersByTime(500);
        });
        waited += 500;
      }
      delays.push(waited);
      unmount();
      vi.advanceTimersByTime(1_000);
    }
    expect(reset).toHaveBeenCalledTimes(7);
    expect(delays).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);

    const { unmount } = render(<BroadcastOverlayError error={error} reset={reset} />);
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(reset).toHaveBeenCalledTimes(7);
  });
});
