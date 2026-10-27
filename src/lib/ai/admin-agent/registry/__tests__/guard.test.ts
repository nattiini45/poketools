import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireAnyAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  requireDraftAdmin: vi.fn(),
  requireFormatViewer: vi.fn(),
}));
vi.mock('@/lib/ruleset-studio/guards', () => ({
  requireRulesetViewer: vi.fn(),
  requireRulesetOwner: vi.fn(),
  assertRulesetUsable: vi.fn(),
}));

import { requireAdmin, requireAnyAdmin, requireDraftAdmin, requireFormatViewer, requireResourceAdmin } from '@/lib/auth/helpers';
import { assertRulesetUsable, requireRulesetOwner, requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import type { SessionPlayer } from '@/types/auth';
import { guardFor, Guarded } from '../guard';

const PLAYER: SessionPlayer = {
  playerId: '11111111-1111-4111-8111-111111111111',
  name: 'Admin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};
const ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(PLAYER);
  vi.mocked(requireAnyAdmin).mockResolvedValue(PLAYER);
  vi.mocked(requireResourceAdmin).mockResolvedValue(PLAYER);
  vi.mocked(requireDraftAdmin).mockResolvedValue(PLAYER);
});

describe('guardFor maps each declared guard to the route helper and returns the LIVE player', () => {
  it('site -> requireAdmin, any -> requireAnyAdmin', async () => {
    const site = await guardFor({ kind: 'site' });
    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(site.kind).toBe('site');
    expect(site.player).toBe(PLAYER);
    const any = await guardFor({ kind: 'any' });
    expect(requireAnyAdmin).toHaveBeenCalledTimes(1);
    expect(any.kind).toBe('any');
  });

  it('season and tournament -> requireResourceAdmin(type, id)', async () => {
    const season = await guardFor({ kind: 'season', id: ID });
    expect(requireResourceAdmin).toHaveBeenLastCalledWith('season', ID);
    expect(season.resourceId).toBe(ID);
    const tournament = await guardFor({ kind: 'tournament', id: ID });
    expect(requireResourceAdmin).toHaveBeenLastCalledWith('tournament', ID);
    expect(tournament.resourceId).toBe(ID);
  });

  it('draft -> requireDraftAdmin(id)', async () => {
    const draft = await guardFor({ kind: 'draft', id: ID });
    expect(requireDraftAdmin).toHaveBeenCalledWith(ID);
    expect(draft.resourceId).toBe(ID);
  });

  it('formatViewer, rulesetViewer and rulesetOwner hand back what their guard returned', async () => {
    const format = { player: PLAYER, definition: { id: ID } };
    vi.mocked(requireFormatViewer).mockResolvedValue(format as never);
    const formatGuarded = await guardFor({ kind: 'formatViewer', id: ID });
    expect(requireFormatViewer).toHaveBeenCalledWith(ID);
    expect(formatGuarded.format).toBe(format);

    const ruleset = { player: PLAYER, definition: { id: ID }, actor: { playerId: PLAYER.playerId, isAdmin: true } };
    vi.mocked(requireRulesetViewer).mockResolvedValue(ruleset as never);
    vi.mocked(requireRulesetOwner).mockResolvedValue(ruleset as never);
    expect((await guardFor({ kind: 'rulesetViewer', id: ID })).ruleset).toBe(ruleset);
    expect(requireRulesetViewer).toHaveBeenCalledWith(ID);
    expect((await guardFor({ kind: 'rulesetOwner', id: ID })).ruleset).toBe(ruleset);
    expect(requireRulesetOwner).toHaveBeenCalledWith(ID);
  });

  it('rulesetUsable runs requireAnyAdmin and then assertRulesetUsable for the live player', async () => {
    const usable = { definition: { id: ID }, version_no: 3 };
    vi.mocked(assertRulesetUsable).mockResolvedValue(usable as never);
    const guarded = await guardFor({ kind: 'rulesetUsable', versionId: ID });
    expect(requireAnyAdmin).toHaveBeenCalledTimes(1);
    expect(assertRulesetUsable).toHaveBeenCalledWith(PLAYER, ID);
    expect(guarded.usable).toBe(usable);
  });

  it('lets a refusal through unchanged and mints no token', async () => {
    const refusal = Object.assign(new Error('Admin access required'), { statusCode: 403, code: 'forbidden' });
    vi.mocked(requireResourceAdmin).mockRejectedValue(refusal);
    await expect(guardFor({ kind: 'season', id: ID })).rejects.toBe(refusal);
  });

  it('does not stop at the first guard: a ruleset the admin may not use is refused after the admin check', async () => {
    const refusal = Object.assign(new Error('x'), { statusCode: 403, code: 'ruleset_forbidden' });
    vi.mocked(assertRulesetUsable).mockRejectedValue(refusal);
    await expect(guardFor({ kind: 'rulesetUsable', versionId: ID })).rejects.toBe(refusal);
    expect(requireAnyAdmin).toHaveBeenCalledTimes(1);
  });
});

describe('the token', () => {
  it('cannot be constructed outside guard.ts: the constructor is private (a type error, checked by tsc)', () => {
    // @ts-expect-error the constructor of Guarded is private
    const forged = new Guarded('any', PLAYER, {});
    // At runtime a forged token is only an object; the type system and the static test below are what stop a read tool
    // from compiling without a guard.
    expect(forged.kind).toBe('any');
  });

  it('is minted in one place only: `new Guarded` appears nowhere but the one cast in guard.ts', () => {
    const root = path.join(process.cwd(), 'src/lib/ai/admin-agent');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'node_modules') walk(full);
        } else if (full.endsWith('.ts')) {
          const source = readFileSync(full, 'utf8');
          if (/new\s+Guarded\b|new\s*\(\s*Guarded\b/.test(source)) hits.push(path.relative(root, full).replaceAll('\\', '/'));
        }
      }
    };
    walk(root);
    expect(hits).toEqual(['registry/guard.ts']);
  });

  it('never imports requireSuperadmin or isSuperadmin (no tool is bound to a superadmin-only action)', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/ai/admin-agent/registry/guard.ts'), 'utf8');
    expect(source).not.toMatch(/requireSuperadmin|isSuperadmin/);
  });
});
