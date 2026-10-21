/**
 * FinderBar's debounced search commit (sweep S4 minor): "Clear all" inside the
 * debounce window must drop the pending text commit, also when the search was
 * empty before typing (the reducer's `text` then stays '' and only the chips change).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTERS, initialFinderState, type FinderFilters } from '@/lib/draft-finder/filter-types';
import { finderReducer } from '@/lib/draft-finder/reducer';
import { SEARCH_DEBOUNCE_MS, createTextCommitter, dropsPendingText } from '../FinderBar';

const withType: FinderFilters = { ...EMPTY_FILTERS, types: { ...EMPTY_FILTERS.types, ids: ['Fire'] } };

describe('dropsPendingText', () => {
  it('drops on an outside text change and on a clear to empty filters', () => {
    expect(dropsPendingText(withType, { ...withType, text: 'x' })).toBe(true);
    expect(dropsPendingText(withType, { ...EMPTY_FILTERS })).toBe(true);
  });

  it('keeps the pending text for an unrelated chip change and for the same object', () => {
    const moreTypes: FinderFilters = { ...withType, types: { ...withType.types, ids: ['Fire', 'Water'] } };
    expect(dropsPendingText(withType, moreTypes)).toBe(false);
    expect(dropsPendingText(withType, withType)).toBe(false);
  });
});

describe('createTextCommitter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits the last typed text after the debounce', () => {
    const commit = vi.fn();
    const c = createTextCommitter(commit);
    c.schedule('a');
    c.schedule('ab');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledExactlyOnceWith('ab');
  });

  it('typing into an empty search, then Clear all within the window: nothing is committed', () => {
    const commit = vi.fn();
    const c = createTextCommitter(commit);
    // A chip is active and the search is empty.
    const before = { ...initialFinderState(), filters: withType };
    c.schedule('gar');
    const after = finderReducer(before, { type: 'clearAll' });
    expect(after.filters.text).toBe('');
    c.filtersChanged(before.filters, after.filters);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(commit).not.toHaveBeenCalled();
  });

  it('a chip toggle inside the window keeps the pending commit', () => {
    const commit = vi.fn();
    const c = createTextCommitter(commit);
    const before = { ...initialFinderState(), filters: withType };
    c.schedule('gar');
    const after = finderReducer(before, { type: 'toggleType', id: 'Water' });
    c.filtersChanged(before.filters, after.filters);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(commit).toHaveBeenCalledExactlyOnceWith('gar');
  });

  it('Enter flushes now and cancel drops the pending commit', () => {
    const commit = vi.fn();
    const c = createTextCommitter(commit);
    c.schedule('ga');
    c.flush('gar');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(commit).toHaveBeenCalledExactlyOnceWith('gar');
    c.schedule('x');
    c.cancel();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
