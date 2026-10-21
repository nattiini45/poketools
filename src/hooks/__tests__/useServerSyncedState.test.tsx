/**
 * `syncFromServer` / `useServerSyncedState`: a control's local copy of a server
 * prop takes over a new prop value (after `router.refresh()` or a remount) unless
 * a save or a draft holds it, and then takes it over once the hold clears.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { syncFromServer, useServerSyncedState } from '../useServerSyncedState';

describe('syncFromServer', () => {
  it('keeps the same state while the server value is unchanged (an optimistic edit stays)', () => {
    const state = { seen: false, local: true };
    expect(syncFromServer(state, false, false)).toBe(state);
  });

  it('takes over a changed server value when nothing holds it', () => {
    expect(syncFromServer({ seen: false, local: false }, true, false)).toEqual({ seen: true, local: true });
  });

  it('a refresh after a successful save confirms the optimistic value', () => {
    expect(syncFromServer({ seen: 'auto', local: 'sakura' }, 'sakura', false)).toEqual({
      seen: 'sakura',
      local: 'sakura',
    });
  });

  it('waits while held, then takes over the new value once the hold clears', () => {
    const held = { seen: 'old', local: 'draft' };
    expect(syncFromServer(held, 'new', true)).toBe(held);
    expect(syncFromServer(held, 'new', false)).toEqual({ seen: 'new', local: 'new' });
  });
});

describe('useServerSyncedState', () => {
  function Probe({ value, hold }: { value: string; hold: boolean }) {
    const [local] = useServerSyncedState(value, hold);
    return <span>{local}</span>;
  }

  it('starts from the server value', () => {
    expect(renderToStaticMarkup(<Probe value="persisted" hold={false} />)).toBe('<span>persisted</span>');
    expect(renderToStaticMarkup(<Probe value="persisted" hold />)).toBe('<span>persisted</span>');
  });
});
