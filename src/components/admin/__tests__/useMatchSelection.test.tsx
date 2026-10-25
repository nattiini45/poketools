/**
 * useMatchSelection: the selection belongs to one list request and is always pruned to the page on screen.
 * There is no DOM, so a probe component plays a script of steps during a single server render: each step runs one
 * action with that step's key and page, and the render-phase state updates carry the selection from step to step.
 */
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useMatchSelection } from '../useMatchSelection';
import { ADMIN_MATCH_BULK_MAX } from '@/lib/admin/match-bulk';

type Selection = ReturnType<typeof useMatchSelection>;
interface Step {
  key?: string;
  pageIds?: readonly string[];
  act?: (selection: Selection) => void;
}

const ids = (count: number, prefix = 'm') => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

/** Runs the steps in order; the result is the hook's output after the last one. */
function run(steps: Step[]): Selection {
  const last = steps[steps.length - 1];
  const handle: { result?: Selection } = {};
  function Probe({ onSettled }: { onSettled: (selection: Selection) => void }) {
    const [index, setIndex] = useState(0);
    const step = steps[Math.min(index, steps.length - 1)];
    const selection = useMatchSelection({ selectionKey: step.key ?? 'a', pageIds: step.pageIds ?? last.pageIds ?? [] });
    if (index < steps.length) {
      step.act?.(selection);
      setIndex(index + 1);
    } else {
      onSettled(selection);
    }
    return null;
  }
  renderToStaticMarkup(<Probe onSettled={(selection) => (handle.result = selection)} />);
  if (!handle.result) throw new Error('the probe did not settle');
  return handle.result;
}

describe('useMatchSelection', () => {
  const page = ids(5);

  it('starts empty', () => {
    const selection = run([{ pageIds: page }]);
    expect(selection.selected).toEqual([]);
    expect(selection.count).toBe(0);
    expect(selection.pageState).toBe('none');
    expect(selection.isSelected('m1')).toBe(false);
  });

  it('toggles single rows and reports them in page order', () => {
    const selection = run([
      { pageIds: page, act: (s) => s.toggle('m4') },
      { pageIds: page, act: (s) => s.toggle('m2') },
      { pageIds: page },
    ]);
    expect(selection.selected).toEqual(['m2', 'm4']);
    expect(selection.count).toBe(2);
    expect(selection.isSelected('m2')).toBe(true);
    expect(selection.isSelected('m1')).toBe(false);
    expect(selection.pageState).toBe('some');

    const off = run([
      { pageIds: page, act: (s) => s.toggle('m2') },
      { pageIds: page, act: (s) => s.toggle('m2') },
      { pageIds: page },
    ]);
    expect(off.selected).toEqual([]);
  });

  it('selects and deselects the whole page', () => {
    const all = run([{ pageIds: page, act: (s) => s.togglePage() }, { pageIds: page }]);
    expect(all.selected).toEqual(page);
    expect(all.pageState).toBe('all');

    const none = run([
      { pageIds: page, act: (s) => s.togglePage() },
      { pageIds: page, act: (s) => s.togglePage() },
      { pageIds: page },
    ]);
    expect(none.selected).toEqual([]);
    expect(none.pageState).toBe('none');

    // With only some selected, the page checkbox selects the rest.
    const rest = run([
      { pageIds: page, act: (s) => s.toggle('m3') },
      { pageIds: page, act: (s) => s.togglePage() },
      { pageIds: page },
    ]);
    expect(rest.selected).toEqual(page);
  });

  it('forgets a selection made under another key, and does not bring it back with the old key', () => {
    const selection = run([
      { key: 'a', pageIds: page, act: (s) => s.togglePage() },
      { key: 'b', pageIds: page },
      { key: 'a', pageIds: page },
    ]);
    expect(selection.selected).toEqual([]);
    expect(selection.count).toBe(0);

    // Under the new key the selection starts from empty and works as usual.
    const fresh = run([
      { key: 'a', pageIds: page, act: (s) => s.togglePage() },
      { key: 'b', pageIds: page, act: (s) => s.toggle('m1') },
      { key: 'b', pageIds: page },
    ]);
    expect(fresh.selected).toEqual(['m1']);
  });

  it('prunes ids that are no longer on the page, keeping page order', () => {
    const selection = run([
      { pageIds: page, act: (s) => s.togglePage() },
      { pageIds: ['m5', 'm2', 'm9'] },
    ]);
    expect(selection.selected).toEqual(['m5', 'm2']);
    expect(selection.pageState).toBe('some');
    expect(selection.isSelected('m1')).toBe(false);

    // While the next page loads (no rows) nothing is selected.
    expect(run([{ pageIds: page, act: (s) => s.togglePage() }, { pageIds: [] }]).selected).toEqual([]);
  });

  it('holds the cap of 100', () => {
    const big = ids(ADMIN_MATCH_BULK_MAX + 20);
    const selection = run([{ pageIds: big, act: (s) => s.togglePage() }, { pageIds: big }]);
    expect(selection.count).toBe(ADMIN_MATCH_BULK_MAX);
    expect(selection.selected).toEqual(big.slice(0, ADMIN_MATCH_BULK_MAX));

    const noop = run([
      { pageIds: big, act: (s) => s.togglePage() },
      { pageIds: big, act: (s) => s.toggle('m101') },
      { pageIds: big },
    ]);
    expect(noop.count).toBe(ADMIN_MATCH_BULK_MAX);
    expect(noop.isSelected('m101')).toBe(false);
  });

  it('keepOnly keeps just the given ids that are on the page', () => {
    const selection = run([
      { pageIds: page, act: (s) => s.togglePage() },
      { pageIds: page, act: (s) => s.keepOnly(['m4', 'm2', 'gone']) },
      { pageIds: page },
    ]);
    expect(selection.selected).toEqual(['m2', 'm4']);

    const emptied = run([
      { pageIds: page, act: (s) => s.togglePage() },
      { pageIds: page, act: (s) => s.keepOnly([]) },
      { pageIds: page },
    ]);
    expect(emptied.selected).toEqual([]);
  });

  it('clear drops the selection', () => {
    const selection = run([
      { pageIds: page, act: (s) => s.togglePage() },
      { pageIds: page, act: (s) => s.clear() },
      { pageIds: page },
    ]);
    expect(selection.selected).toEqual([]);
  });
});
