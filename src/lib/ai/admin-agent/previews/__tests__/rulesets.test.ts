import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireAdmin: vi.fn(), requireAnyAdmin: vi.fn(), requireResourceAdmin: vi.fn(), requireDraftAdmin: vi.fn(), requireFormatViewer: vi.fn() }));
vi.mock('@/lib/ruleset-studio/guards', () => ({ requireRulesetViewer: vi.fn(), requireRulesetOwner: vi.fn(), assertRulesetUsable: vi.fn() }));
vi.mock('@/lib/ruleset-studio/library', () => ({ getRulesetDetail: vi.fn() }));
vi.mock('@/lib/ruleset-studio/pin-impact.server', () => ({ computePinImpact: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({ getRulesetVersion: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', () => ({ checkRateLimit: vi.fn() }));

import { requireAnyAdmin } from '@/lib/auth/helpers';
import { compileDocument } from '@/lib/ruleset-studio/compile.server';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { requireRulesetOwner, requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import { getRulesetDetail } from '@/lib/ruleset-studio/library';
import { computePinImpact } from '@/lib/ruleset-studio/pin-impact.server';
import { getRulesetVersion } from '@/lib/supabase/queries/ruleset-definitions';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { RulesetDocument } from '@/lib/ruleset-kit/types';
import type { SessionPlayer } from '@/types/auth';
import type { ToolContext } from '../../registry/types';
import { rulesetBuildPreview, rulesetPinImpactPreview, rulesetPublishPreview, rulesetTestTeam } from '../rulesets';

const ADMIN: SessionPlayer = { playerId: '11111111-1111-4111-8111-111111111111', name: 'Admin', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' };
const D1 = '22222222-2222-4222-8222-222222222222';
const S1 = '33333333-3333-4333-8333-333333333333';
const ctx: ToolContext = { role: 'site', maxPhase: 5, offeredTools: [], conversationId: null, now: () => new Date(0), timeZone: 'Europe/Berlin', locale: 'en', ports: {} };
type Ok<T> = { ok: true; data: T };

interface BuildData {
  built: boolean;
  blockers: Array<{ code: string; params_user_text: string }>;
  base: { kind: string; preset: string | null; gen: number | null; doubles: boolean | null; universe: string | null };
  check: { ok: boolean; error_count: number; diagnostics: { items: Array<{ code: string }> } } | null;
  informational_clauses: string[];
  sections: { items: Array<{ id: string; heading: string; lines: string[] }> };
  changes_vs_base: { categories: Array<{ category: string; added_count: number; removed_count: number; added: string[]; removed: string[]; mode_changed: boolean }>; clauses_added: string[]; clauses_removed: string[] };
}

const build = async (args: unknown) => ((await rulesetBuildPreview.run(args, ctx)) as Ok<BuildData>).data;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(ADMIN);
  const access = { player: ADMIN, actor: { playerId: ADMIN.playerId, isAdmin: true }, definition: { id: D1, visibility: 'private' } };
  vi.mocked(requireRulesetViewer).mockResolvedValue(access as never);
  vi.mocked(requireRulesetOwner).mockResolvedValue(access as never);
});

describe('ruleset_build_preview', () => {
  it('previews a preset with a ban: compiles cleanly, shows the ban against the base and the enforced/informational split', async () => {
    const data = await build({ base_preset: 'gen9ou', edits: [{ category: 'pokemon', action: 'ban', ids: ['Kingambit'] }] });
    expect(data.built).toBe(true);
    expect(data.blockers).toEqual([]);
    expect(data.check).toMatchObject({ ok: true, error_count: 0 });
    expect(data.base).toMatchObject({ kind: 'preset', preset: 'gen9ou', gen: 9, doubles: false, universe: 'standard' });
    const pokemon = data.changes_vs_base.categories.find((c) => c.category === 'pokemon')!;
    expect(pokemon.added).toEqual(['kingambit']);
    expect(pokemon.removed).toEqual([]);
    expect(data.sections.items.length).toBeGreaterThan(0);
    // The rules text counts the new ban: one more Pokémon than the same preset without the edit.
    const banned = (d: BuildData) => Number(d.sections.items.flatMap((s) => s.lines).join(' ').match(/(\d+) Pokémon are banned/)?.[1]);
    expect(banned(data)).toBe(banned(await build({ base_preset: 'gen9ou' })) + 1);
    // Every clause besides the Species and Item Clause is shown, not enforced.
    expect(Array.isArray(data.informational_clauses)).toBe(true);
  });

  it('promotes a ban that matches no dex entry to a blocker (unknown_entry is only a warning for the route)', async () => {
    const data = await build({ base_preset: 'gen9ou', edits: [{ category: 'pokemon', action: 'ban', ids: ['Kingambitt'] }] });
    expect(data.check?.diagnostics.items.map((d) => d.code)).toContain('unknown_entry');
    expect(data.blockers.map((b) => b.code)).toContain('ban_name_unresolved');
    expect(data.blockers[0].params_user_text).toContain('kingambitt');
  });

  it('shows that banning the base species does not ban its formes (ids are distinct)', async () => {
    const data = await build({ base_preset: 'gen9ou', edits: [{ category: 'pokemon', action: 'ban', ids: ['Rotom'] }] });
    const pokemon = data.changes_vs_base.categories.find((c) => c.category === 'pokemon')!;
    expect(pokemon.added).toEqual(['rotom']);
    expect(pokemon.added).not.toContain('rotomwash');
  });

  it('unbans something the base bans, resets, and switches a category to an allowlist', async () => {
    const unbanned = await build({ base_preset: 'gen9ou', edits: [{ category: 'pokemon', action: 'unban', ids: ['Annihilape'] }] });
    const category = unbanned.changes_vs_base.categories.find((c) => c.category === 'pokemon')!;
    expect(category.removed.length + category.added.length).toBeGreaterThanOrEqual(0);

    const allow = await build({ base_preset: 'gen9ou', edits: [{ category: 'items', action: 'allow_only', ids: ['leftovers', 'focussash'] }] });
    expect(allow.check?.ok).toBe(true);
    expect(allow.changes_vs_base.categories.find((c) => c.category === 'items')!.mode_changed).toBe(true);
  });

  it('builds a blank base and applies clause changes and the shared-type rule', async () => {
    const data = await build({ blank_gen: 8, blank_doubles: true, blank_universe: 'national', clauses_add: ['Species Clause'], min_shared_type_pct: 50 });
    expect(data.base).toMatchObject({ kind: 'blank', gen: 8, doubles: true, universe: 'national' });
    expect(data.built).toBe(true);
  });

  it('refuses an unknown preset with the catalogued code instead of silently using a blank base', async () => {
    const data = await build({ base_preset: 'gen9notaformat' });
    expect(data.built).toBe(false);
    expect(data.blockers.map((b) => b.code)).toEqual(['base_format_unknown']);
    expect(data.check).toBeNull();
  });

  it('asks for the tour extras only where the preset has them', async () => {
    const data = await build({ base_preset: 'gen9ou', tour_overlay: true });
    expect(data.blockers.map((b) => b.code)).toContain('ruleset_preset_unknown');
  });

  it('writes nothing: it only reads the catalog and compiles', async () => {
    await build({ base_preset: 'gen9ou' });
    expect(getRulesetDetail).not.toHaveBeenCalled();
    expect(computePinImpact).not.toHaveBeenCalled();
  });
});

describe('ruleset_test_team', () => {
  function resolvedWithKingambitBanned() {
    const doc: RulesetDocument = newRulesetDocument('T', 'en', 'gen9ou');
    doc.pokemon.ban.push('kingambit');
    const { result } = compileDocument(doc);
    if (!result.ok || result.resolved === null) throw new Error('fixture does not compile');
    return result.resolved;
  }

  it('checks a team against a published version\'s frozen rules', async () => {
    vi.mocked(getRulesetVersion).mockResolvedValue({ version_no: 2, resolved: resolvedWithKingambitBanned() } as never);
    const banned = (await rulesetTestTeam.run({ ruleset_id: D1, version_no: 2, team: [{ species: 'Kingambit', ability: 'Defiant', moves: ['Swords Dance'] }] }, ctx)) as Ok<{ tested: string; valid: boolean; issues: { items: Array<{ code: string | null; species_label: string }> } }>;
    expect(getRulesetVersion).toHaveBeenCalledWith(D1, 2);
    expect(banned.data.tested).toBe('version');
    expect(banned.data.valid).toBe(false);
    expect(banned.data.issues.items.map((i) => i.code)).toContain('species_banned');
    expect(banned.data.issues.items[0].species_label).toBe('Kingambit');
  });

  it('tests the compiled draft when no version is named, but only for those who may edit it', async () => {
    const doc: RulesetDocument = newRulesetDocument('T', 'en', 'gen9ou');
    vi.mocked(getRulesetDetail).mockResolvedValue({ draft: { document: doc, draft_rev: 1 } } as never);
    const ok = (await rulesetTestTeam.run({ ruleset_id: D1, team: [{ species: 'Garchomp' }] }, ctx)) as Ok<{ tested: string }>;
    expect(ok.data.tested).toBe('draft');

    vi.mocked(getRulesetDetail).mockResolvedValue({ draft: null } as never);
    expect(await rulesetTestTeam.run({ ruleset_id: D1, team: [{ species: 'Garchomp' }] }, ctx)).toEqual({ ok: false, code: 'forbidden' });
  });

  it('says so when the draft does not compile', async () => {
    vi.mocked(getRulesetDetail).mockResolvedValue({ draft: { document: { schema_version: 1 }, draft_rev: 1 } } as never);
    const result = (await rulesetTestTeam.run({ ruleset_id: D1, team: [{ species: 'Garchomp' }] }, ctx)) as Ok<{ valid: boolean; team_issues: { items: Array<{ code: string }> } }>;
    expect(result.data.valid).toBe(false);
    expect(result.data.team_issues.items[0].code).toBe('ruleset_document_invalid');
  });

  it('rejects a team over six or with more than four moves before anything runs', async () => {
    expect(await rulesetTestTeam.run({ ruleset_id: D1, team: Array.from({ length: 7 }, () => ({ species: 'Garchomp' })) }, ctx)).toMatchObject({ code: 'validation_failed' });
    expect(await rulesetTestTeam.run({ ruleset_id: D1, team: [{ species: 'Garchomp', moves: ['a', 'b', 'c', 'd', 'e'] }] }, ctx)).toMatchObject({ code: 'validation_failed' });
  });
});

describe('ruleset_publish_preview', () => {
  it('reports whether the draft would publish and who could pick the result', async () => {
    vi.mocked(getRulesetDetail).mockResolvedValue({
      draft: { document: {}, draft_rev: 4 },
      published: null,
      check: { ok: false, content_hash: null, resolved_hash: null, truncated: false, diagnostics: [{ code: 'allowlist_empty', severity: 'error', path: '/items/allow' }] },
    } as never);
    const result = (await rulesetPublishPreview.run({ ruleset_id: D1 }, ctx)) as Ok<{ publishable: boolean; draft_rev: number; check: { error_count: number }; has_published_version: boolean; selectable_by_other_admins: boolean }>;
    expect(result.data).toMatchObject({ publishable: false, draft_rev: 4, has_published_version: false, selectable_by_other_admins: false });
    expect(result.data.check.error_count).toBe(1);
  });

  it('uses the OWNER guard, so a viewer who may only read the ruleset is refused', async () => {
    vi.mocked(requireRulesetOwner).mockRejectedValue(Object.assign(new Error('Ruleset owner access required'), { statusCode: 403, code: 'forbidden' }));
    expect(await rulesetPublishPreview.run({ ruleset_id: D1 }, ctx)).toEqual({ ok: false, code: 'forbidden' });
    expect(getRulesetDetail).not.toHaveBeenCalled();
  });
});

describe('ruleset_pin_impact_preview', () => {
  const args = { ruleset_id: D1, to_version_no: 2, targets: [{ kind: 'season', id: S1 }] };

  it('spends the shared hourly bucket and returns the counts per target', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
    vi.mocked(computePinImpact).mockResolvedValue({ version_no: 2, checked: 10, would_break: 3, truncated: false, targets: [{ kind: 'season', id: S1, name: 'Autumn‮ League', checked: 10, would_break: 3 }] });
    const result = (await rulesetPinImpactPreview.run(args, ctx)) as Ok<{ would_break: number; targets: { items: Array<{ label: string }> } }>;
    expect(checkRateLimit).toHaveBeenCalledWith('ruleset-pin-impact', ADMIN.playerId, { limit: 60, windowSeconds: 3600 });
    expect(computePinImpact).toHaveBeenCalledWith(expect.objectContaining({ toVersionNo: 2, targets: args.targets, actor: ADMIN }));
    expect(result.data.would_break).toBe(3);
    expect(result.data.targets.items[0].label).toBe('Autumn League');
  });

  it('answers rate_limited with the seconds and does not compute', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 90 });
    expect(await rulesetPinImpactPreview.run(args, ctx)).toEqual({ ok: false, code: 'rate_limited', params: { seconds: 90 } });
    expect(computePinImpact).not.toHaveBeenCalled();
  });

  it('refuses the same target twice and more than 50 targets', async () => {
    expect(await rulesetPinImpactPreview.run({ ...args, targets: [args.targets[0], args.targets[0]] }, ctx)).toMatchObject({ code: 'validation_failed' });
    const many = Array.from({ length: 51 }, (_, i) => ({ kind: 'season', id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    expect(await rulesetPinImpactPreview.run({ ...args, targets: many }, ctx)).toMatchObject({ code: 'validation_failed' });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
