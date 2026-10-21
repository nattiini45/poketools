/**
 * The pack-extension seam (docs/format-packs.md, "Pack extensions"): absent providers cost
 * nothing (no session read, no call), the include decision gates every provider, a failed data
 * provider is logged and reported as `failed` (never masked), a failed link or label provider
 * propagates, and the example pack has none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackExtensions } from '../types';

const mocks = vi.hoisted(() => ({
  extensions: {} as Record<string, unknown>,
  getSessionPlayer: vi.fn(),
}));

vi.mock('@pack-extensions', () => ({ default: mocks.extensions }));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: mocks.getSessionPlayer }));

import { extensionAdminLinks, extensionAuditActionLabels, loadSupplement, packExtensions, siteNavExtraLinks } from '..';
import exampleExtensions from '@/format-packs/example/extensions';

function setExtensions(ext: PackExtensions): void {
  for (const key of Object.keys(mocks.extensions)) delete mocks.extensions[key];
  Object.assign(mocks.extensions, ext);
}

beforeEach(() => {
  setExtensions({});
  mocks.getSessionPlayer.mockReset();
  mocks.getSessionPlayer.mockResolvedValue({ playerId: 'viewer-1' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('example pack', () => {
  it('has no extensions at all', () => {
    expect(exampleExtensions).toEqual({});
  });
});

describe('loadSupplement', () => {
  it('is absent without a provider and reads neither the session nor the include decision', async () => {
    const include = vi.fn();
    setExtensions({ includeSupplementaryRecords: include });
    await expect(loadSupplement('supplementaryKillRanking', packExtensions.supplementaryKillRanking)).resolves.toEqual({
      state: 'absent',
    });
    expect(mocks.getSessionPlayer).not.toHaveBeenCalled();
    expect(include).not.toHaveBeenCalled();
  });

  it('runs the provider with the viewer context when the records count', async () => {
    const include = vi.fn().mockResolvedValue(true);
    const provider = vi.fn().mockResolvedValue([{ pokemonName: 'Garchomp', kos: 12 }]);
    setExtensions({ includeSupplementaryRecords: include, supplementaryKillRanking: provider });
    await expect(loadSupplement('supplementaryKillRanking', packExtensions.supplementaryKillRanking)).resolves.toEqual({
      state: 'ready',
      value: [{ pokemonName: 'Garchomp', kos: 12 }],
    });
    expect(include).toHaveBeenCalledWith({ viewerPlayerId: 'viewer-1' });
    expect(provider).toHaveBeenCalledWith({ viewerPlayerId: 'viewer-1' });
  });

  it('passes a null viewer for a signed-out request', async () => {
    mocks.getSessionPlayer.mockResolvedValue(null);
    const provider = vi.fn().mockResolvedValue(null);
    setExtensions({ supplementaryKillRanking: provider });
    await loadSupplement('supplementaryKillRanking', packExtensions.supplementaryKillRanking);
    expect(provider).toHaveBeenCalledWith({ viewerPlayerId: null });
  });

  it('is excluded (and the provider never runs) when the records do not count for the viewer', async () => {
    const provider = vi.fn();
    setExtensions({ includeSupplementaryRecords: vi.fn().mockResolvedValue(false), supplementaryKillRanking: provider });
    await expect(loadSupplement('supplementaryKillRanking', packExtensions.supplementaryKillRanking)).resolves.toEqual({
      state: 'excluded',
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('counts the records when the pack has no include decision', async () => {
    setExtensions({ supplementaryPokemonKos: vi.fn().mockResolvedValue({ kos: 3 }) });
    const provider = packExtensions.supplementaryPokemonKos;
    await expect(
      loadSupplement('supplementaryPokemonKos', provider ? (ctx) => provider('Garchomp', ctx) : undefined),
    ).resolves.toEqual({ state: 'ready', value: { kos: 3 } });
  });

  it('reports a failed provider as failed and logs it with its name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('read timed out');
    setExtensions({ supplementaryKillRanking: vi.fn().mockRejectedValue(boom) });
    await expect(loadSupplement('supplementaryKillRanking', packExtensions.supplementaryKillRanking)).resolves.toEqual({
      state: 'failed',
    });
    expect(error).toHaveBeenCalledWith('[pack-extensions] supplementaryKillRanking failed:', boom);
  });

  it('reports a failed include decision as failed (never as included or excluded)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = vi.fn();
    const boom = new Error('settings row missing');
    setExtensions({ includeSupplementaryRecords: vi.fn().mockRejectedValue(boom), supplementaryKillRanking: provider });
    await expect(loadSupplement('supplementaryKillRanking', packExtensions.supplementaryKillRanking)).resolves.toEqual({
      state: 'failed',
    });
    expect(provider).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[pack-extensions] supplementaryKillRanking failed:', boom);
  });
});

describe('extensionAuditActionLabels', () => {
  it('is empty without a provider', async () => {
    await expect(extensionAuditActionLabels()).resolves.toEqual({});
  });

  it('keeps only extension.* actions with a non-empty label', async () => {
    setExtensions({
      auditActionLabels: vi.fn().mockResolvedValue({
        'extension.archive.refresh': 'Archive refreshed',
        'extension.archive.blank': '  ',
        'player.role.assign': 'relabelled built-in',
      }),
    });
    await expect(extensionAuditActionLabels()).resolves.toEqual({ 'extension.archive.refresh': 'Archive refreshed' });
  });

  it('propagates a failed provider (never swallowed into an empty map)', async () => {
    const boom = new Error('boom');
    setExtensions({ auditActionLabels: vi.fn().mockRejectedValue(boom) });
    await expect(extensionAuditActionLabels()).rejects.toBe(boom);
  });
});

describe('siteNavExtraLinks', () => {
  it('is empty without a provider', async () => {
    await expect(siteNavExtraLinks()).resolves.toEqual([]);
  });

  it('copies href and label only', async () => {
    setExtensions({
      siteNavItems: vi.fn().mockResolvedValue([{ href: '/extra-page', label: 'Extra page', extra: 'dropped' }]),
    });
    await expect(siteNavExtraLinks()).resolves.toEqual([{ href: '/extra-page', label: 'Extra page' }]);
  });

  it('propagates a failed provider (never swallowed into an empty list)', async () => {
    const boom = new Error('boom');
    setExtensions({ siteNavItems: vi.fn().mockRejectedValue(boom) });
    await expect(siteNavExtraLinks()).rejects.toBe(boom);
  });
});

describe('extensionAdminLinks', () => {
  it('is empty without a provider', async () => {
    await expect(extensionAdminLinks()).resolves.toEqual([]);
  });

  it('copies the documented fields only', async () => {
    setExtensions({
      adminLinks: vi.fn().mockResolvedValue([
        { href: '/admin/extra', label: 'Extra', group: 'system', superadminOnly: true, extra: 'dropped' },
      ]),
    });
    await expect(extensionAdminLinks()).resolves.toEqual([
      { href: '/admin/extra', label: 'Extra', group: 'system', siteAdminOnly: undefined, superadminOnly: true },
    ]);
  });

  it('propagates a failed provider', async () => {
    const boom = new Error('boom');
    setExtensions({ adminLinks: vi.fn().mockRejectedValue(boom) });
    await expect(extensionAdminLinks()).rejects.toBe(boom);
  });
});
