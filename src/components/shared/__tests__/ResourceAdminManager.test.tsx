/**
 * ResourceAdminManager surfaces a failed grant or revoke (a refusal, a server
 * error, a lost connection) the way it already surfaces a failed player search,
 * instead of leaving the admin list unchanged with no word. A failed load of
 * the list is surfaced the same way, never as "no admins". The request helpers
 * run against a fake fetch; the alert is rendered through static markup with
 * the `react` mock seeding the post-load state (node env, no DOM).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { renderWithI18n } from '@/test/i18n';

const seed = vi.hoisted(() => ({
  failure: null as { action: 'add' | 'remove'; error: ApiErrorLike } | null,
  loadFailure: null as ApiErrorLike | null,
  nullSeen: 0,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = <T,>(initial: T | (() => T)) => {
    // Loaded already (effects do not run in a server render).
    if (initial === true) return actual.useState(false as T);
    // The null states, in declaration order: selected, searchError, writeFailure, loadFailure.
    if (initial === null) {
      const index = seed.nullSeen++;
      if (index === 2) return actual.useState(seed.failure as T);
      if (index === 3) return actual.useState(seed.loadFailure as T);
    }
    return actual.useState(initial);
  };
  return { ...actual, default: { ...actual, useState }, useState };
});

const { default: ResourceAdminManager, changeResourceAdmin, loadResourceAdmins } = await import('../ResourceAdminManager');

const BODY = { player_id: 'p-1', resource_type: 'season', resource_id: 's-1' } as const;

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('changeResourceAdmin', () => {
  it('POSTs a grant and DELETEs a revoke as JSON', async () => {
    const fetchImpl = respond(201, { success: true, data: {} });

    expect(await changeResourceAdmin('POST', BODY, fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith('/api/resource-admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    const revoke = respond(200, { success: true, data: null });
    expect(await changeResourceAdmin('DELETE', BODY, revoke)).toBeNull();
    expect(vi.mocked(revoke).mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('returns a refusal with its code', async () => {
    const fetchImpl = respond(403, { success: false, error: 'Forbidden', code: 'forbidden' });

    expect(await changeResourceAdmin('POST', BODY, fetchImpl)).toEqual({ error: 'Forbidden', code: 'forbidden' });
  });

  it('returns an unknown error for a failure whose body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;

    expect(await changeResourceAdmin('DELETE', BODY, fetchImpl)).toEqual({});
  });

  it('returns a network error when the request never gets an answer', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    expect(await changeResourceAdmin('POST', BODY, offline)).toEqual({ code: 'network_error' });
  });
});

describe('loadResourceAdmins', () => {
  const ADMIN = { id: 'ra-1', player_id: 'p-1', player_name: 'Ash' };

  it('GETs the admins of the resource', async () => {
    const fetchImpl = respond(200, { success: true, data: [ADMIN] });

    expect(await loadResourceAdmins('season', 's-1', fetchImpl)).toEqual({ ok: true, admins: [ADMIN] });
    expect(fetchImpl).toHaveBeenCalledWith('/api/resource-admins?resource_type=season&resource_id=s-1');
  });

  it('reports a resource without admins as an empty list, not as a failure', async () => {
    const fetchImpl = respond(200, { success: true, data: [] });

    expect(await loadResourceAdmins('season', 's-1', fetchImpl)).toEqual({ ok: true, admins: [] });
  });

  it('returns a refusal with its code', async () => {
    const fetchImpl = respond(403, { success: false, error: 'Forbidden', code: 'forbidden' });

    expect(await loadResourceAdmins('season', 's-1', fetchImpl)).toEqual({
      ok: false,
      error: { error: 'Forbidden', code: 'forbidden' },
    });
  });

  it('returns an unknown error for an answer that is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;

    expect(await loadResourceAdmins('season', 's-1', fetchImpl)).toEqual({ ok: false, error: {} });
  });

  it('returns a network error when the request never gets an answer', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    expect(await loadResourceAdmins('season', 's-1', offline)).toEqual({ ok: false, error: { code: 'network_error' } });
  });
});

describe('ResourceAdminManager failure alert', () => {
  const render = (locale: 'en' | 'de' = 'en') =>
    renderWithI18n(<ResourceAdminManager resourceType="season" resourceId="s-1" />, { locale });

  it('shows nothing when no write has failed', () => {
    seed.nullSeen = 0;
    seed.failure = null;

    expect(render()).not.toContain('role="alert"');
  });

  it('says why a grant failed', () => {
    seed.nullSeen = 0;
    seed.failure = { action: 'add', error: { code: 'forbidden' } };

    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not add the admin: You do not have permission to do this.');
    expect(html).not.toContain('Could not remove the admin');
  });

  it('says why a revoke failed', () => {
    seed.nullSeen = 0;
    seed.failure = { action: 'remove', error: { code: 'network_error' } };

    expect(render()).toContain('Could not remove the admin: Network error. Check your connection and try again.');
  });

  it('is translated to German', () => {
    seed.nullSeen = 0;
    seed.failure = { action: 'add', error: { code: 'network_error' } };

    expect(render('de')).toContain('Der Admin konnte nicht hinzugefügt werden: ');
  });
});

describe('ResourceAdminManager load failure', () => {
  const render = (locale: 'en' | 'de' = 'en') =>
    renderWithI18n(<ResourceAdminManager resourceType="season" resourceId="s-1" />, { locale });

  it('says "no admins" when the list loaded empty', () => {
    seed.nullSeen = 0;
    seed.failure = null;
    seed.loadFailure = null;

    const html = render();
    expect(html).toContain('No resource admins assigned.');
    expect(html).not.toContain('Could not load the admins');
  });

  it('says why the list could not be loaded instead of "no admins"', () => {
    seed.nullSeen = 0;
    seed.failure = null;
    seed.loadFailure = { code: 'network_error' };

    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not load the admins: Network error. Check your connection and try again.');
    expect(html).not.toContain('No resource admins assigned.');
  });

  it('is translated to German', () => {
    seed.nullSeen = 0;
    seed.failure = null;
    seed.loadFailure = { code: 'network_error' };

    expect(render('de')).toContain('Die Admins konnten nicht geladen werden: ');
  });
});
