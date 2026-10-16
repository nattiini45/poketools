import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Session } from 'next-auth';

const { providerProps, sessionContext } = vi.hoisted(() => ({
  providerProps: [] as Array<Record<string, unknown>>,
  sessionContext: {
    value: {
      data: null as Session | null,
      status: 'unauthenticated' as string,
      update: (async () => null) as (data?: unknown) => Promise<Session | null>,
    },
  },
}));

vi.mock('next-auth/react', () => ({
  SessionProvider: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    providerProps.push(props);
    return <>{props.children}</>;
  },
  useSession: () => sessionContext.value,
}));

import SessionProvider, {
  SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS,
  useRefreshSessionPlayer,
} from '../SessionProvider';

const SESSION: Session = {
  user: { id: 'discord-1', name: 'Ash', email: null, image: null },
  player: null,
  expires: '2099-01-01',
};

beforeEach(() => {
  providerProps.length = 0;
  sessionContext.value = { data: null, status: 'unauthenticated', update: async () => null };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionProvider', () => {
  it('does not refetch on window focus and leaves next-auth polling off (the keep-fresh loop replaces it)', () => {
    const html = renderToStaticMarkup(
      <SessionProvider>
        <span>child</span>
      </SessionProvider>
    );

    // The keep-fresh child renders nothing.
    expect(html).toBe('<span>child</span>');
    expect(providerProps).toHaveLength(1);
    expect(providerProps[0].refetchOnWindowFocus).toBe(false);
    expect(providerProps[0].refetchInterval ?? 0).toBe(0);
  });

  it('renders the same markup with a session (the loop runs only in an effect, never during render)', () => {
    const update = vi.fn(async () => SESSION);
    sessionContext.value = { data: SESSION, status: 'authenticated', update };
    const html = renderToStaticMarkup(
      <SessionProvider>
        <span>child</span>
      </SessionProvider>
    );
    expect(html).toBe('<span>child</span>');
    expect(update).not.toHaveBeenCalled();
  });

  it('without a server session, leaves session undefined so the client fetches once on mount', () => {
    renderToStaticMarkup(<SessionProvider>x</SessionProvider>);
    expect(providerProps[0].session).toBeUndefined();
  });

  it('forwards a server session when one is passed', () => {
    renderToStaticMarkup(<SessionProvider session={SESSION}>x</SessionProvider>);
    expect(providerProps[0].session).toBe(SESSION);
  });
});

describe('useRefreshSessionPlayer', () => {
  type Refresh = () => Promise<boolean>;

  function Probe({ onHook }: { onHook: (refresh: Refresh) => void }) {
    onHook(useRefreshSessionPlayer());
    return null;
  }

  function captureRefresh(): Refresh {
    const captured: Refresh[] = [];
    renderToStaticMarkup(<Probe onHook={(refresh) => captured.push(refresh)} />);
    if (captured.length !== 1) throw new Error('hook did not run');
    return captured[0];
  }

  it('forces a server re-read with update({}) (trigger "update") and resolves true', async () => {
    const update = vi.fn(async () => SESSION);
    sessionContext.value = { data: SESSION, status: 'authenticated', update };

    const refresh = captureRefresh();
    expect(update).not.toHaveBeenCalled();

    await expect(refresh()).resolves.toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({});
  });

  it('resolves false without throwing when the refresh keeps failing', async () => {
    vi.useFakeTimers();
    const update = vi.fn(async () => {
      throw new Error('offline');
    });
    sessionContext.value = { data: SESSION, status: 'authenticated', update };

    const result = captureRefresh()();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toBe(false);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('is bounded: a refresh that never answers resolves false at the deadline', async () => {
    vi.useFakeTimers();
    const update = vi.fn(() => new Promise<Session | null>(() => undefined));
    sessionContext.value = { data: SESSION, status: 'authenticated', update };

    let outcome: boolean | undefined;
    void captureRefresh()().then((ok) => {
      outcome = ok;
    });
    await vi.advanceTimersByTimeAsync(SESSION_SELF_EDIT_REFRESH_TIMEOUT_MS - 1);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
