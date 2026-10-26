/**
 * DF3 `/draft-preview` (draft-frontend §11.1): the fixture list, every scenario,
 * the in-memory backend (pick screen, redraft, tokens, admin writes, audit),
 * and that every scenario mounts its real screen (draft room, RedraftCenter,
 * TokenCenter, DraftControlPanel, DraftAuditViewer) in English and German
 * with `fetch` stubbed to throw, so any network call fails the test.
 */
import type { ComponentType } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderWithI18n } from '@/test/i18n';
import { buildDraftSearchIndex } from '@/lib/draft-finder/build-index.server';
import type { DraftSearchIndex } from '@/lib/draft-finder/index-types';
import { buildLineCatalog } from '@/lib/draft-finder/line-catalog';
import { countByTab, PRICE_TABS } from '@/lib/draft-finder/tabs';
import { epbPack } from '@/lib/format-pack';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { DEFAULT_BANNED_MOVES } from '@/types/format-rules';
import { auditQueryString } from '@/components/draft-admin/admin-actions';
import en from '@/i18n/messages/draft/screen/en';
import de from '@/i18n/messages/draft/screen/de';
import { auditQueryFrom, createFakeDataSource, filterAudit } from '../fake-source';
import {
  buildPreviewScenario,
  isPreviewScenario,
  MANY_DRAFTED,
  PREVIEW_ENTRIES,
  PREVIEW_LIST_VERSION_ID,
  PREVIEW_PARTICIPATION_LINE,
  PREVIEW_PRESET_LINES,
  PREVIEW_SCENARIOS,
  PREVIEW_WALL_MAX_PRICE,
  PREVIEW_WALL_PIN,
  type PreviewScenario,
  type PreviewScreen,
} from '../fixtures';
import { activeFilterCount, openFilterGroups } from '@/lib/draft-finder/filter-groups';
import PreviewClient, { presetView } from '../PreviewClient';

// ── mount spies: the REAL screens render; each records its props ────────────

const mounts = vi.hoisted(() => ({ list: [] as { name: string; props: Record<string, unknown> }[] }));

/** Wraps a real default export so a render records its name and props, then renders the real component. */
function spyOn<P extends object>(name: string, Real: ComponentType<P>): ComponentType<P> {
  function Spy(props: P) {
    mounts.list.push({ name, props: props as Record<string, unknown> });
    return <Real {...props} />;
  }
  return Spy;
}

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}));
vi.mock('@/components/draft-tool/DraftToolClient', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/draft-tool/DraftToolClient')>();
  return { ...mod, default: spyOn('DraftToolClient', mod.default) };
});
vi.mock('@/components/draft-redraft/RedraftCenter', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/draft-redraft/RedraftCenter')>();
  return { ...mod, default: spyOn('RedraftCenter', mod.default) };
});
vi.mock('@/components/draft-tokens/TokenCenter', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/draft-tokens/TokenCenter')>();
  return { ...mod, default: spyOn('TokenCenter', mod.default) };
});
vi.mock('@/components/draft-admin/DraftControlPanel', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/draft-admin/DraftControlPanel')>();
  return { ...mod, default: spyOn('DraftControlPanel', mod.default) };
});
vi.mock('@/components/draft-admin/TokenAdminSummary', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/draft-admin/TokenAdminSummary')>();
  return { ...mod, default: spyOn('TokenAdminSummary', mod.default) };
});
vi.mock('@/components/draft-admin/DraftAuditViewer', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/draft-admin/DraftAuditViewer')>();
  return { ...mod, default: spyOn('DraftAuditViewer', mod.default) };
});

// Scenarios are anchored to NOW and the fake source reads the system clock (Date.now), so the
// whole file runs on a fake Date pinned to NOW: deadlines built from NOW can never expire
// against the real date. Only Date is faked; setTimeout (the fake latency) stays real.
const NOW = Date.UTC(2026, 9, 11, 18, 0, 0);
const DAWN = '00000000-0000-4000-8000-000000000007';
const MISTY = '00000000-0000-4000-8000-000000000008';
/** A cheap example line nobody drafts before Dawn's turn. */
const FREE_LINE = 'sprigatito--meowscarada';
const CONFIRM_LINE = PREVIEW_PRESET_LINES.confirm;

const fetchSpy = vi.fn((): never => {
  throw new Error('the preview must not use the network');
});
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', fetchSpy);
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(fetchSpy).not.toHaveBeenCalled();
});

function build(id: (typeof PREVIEW_SCENARIOS)[number]): PreviewScenario {
  return buildPreviewScenario(id, NOW);
}

describe('fixture-lines.example.json (make-example-list-fixtures output)', () => {
  it('holds the 48 synthetic lines with unique line ids and entry ids', () => {
    expect(PREVIEW_ENTRIES).toHaveLength(48);
    expect(new Set(PREVIEW_ENTRIES.map((e) => e.line_id)).size).toBe(48);
    expect(new Set(PREVIEW_ENTRIES.map((e) => e.id)).size).toBe(48);
    expect(PREVIEW_ENTRIES.every((e) => e.list_version_id === PREVIEW_LIST_VERSION_ID)).toBe(true);
  });

  it('prices every line inside one of the example price tabs', () => {
    const price = new Map(PREVIEW_ENTRIES.map((e) => [e.line_id ?? '', e.price]));
    const counts = countByTab(price.keys(), (id) => price.get(id) ?? 0);
    expect(counts.all).toBe(48);
    expect(PRICE_TABS.reduce((sum, t) => sum + counts[t.key], 0)).toBe(48);
  });

  it('has the example override applied to the participation line and no prose columns', () => {
    const [override] = epbPack.lineOverrides;
    const line = PREVIEW_ENTRIES.find((e) => e.line_id === override.line_id);
    expect(PREVIEW_PARTICIPATION_LINE).toBe(override.line_id);
    expect(line?.kills_to_stage2).toBe(override.kills_to_stage2);
    expect(line?.additional_kills_to_stage3).toBe(override.additional_kills_to_stage3);
    expect(line?.special_rules).toMatchObject({ cosmog: true, no_redraft: true });
    expect(PREVIEW_ENTRIES.every((e) => e.rationale === null && e.historical_data === null && e.sources === null)).toBe(true);
  });

  it('keeps the branched pairs as separate lines', () => {
    for (const base of ['ralts', 'eevee', 'oddish', 'pichu']) {
      expect(PREVIEW_ENTRIES.filter((e) => e.line_id?.startsWith(`${base}--`))).toHaveLength(2);
    }
  });
});

describe('scenarios', () => {
  it('knows every scenario id and has one picker label per scenario in both languages', () => {
    for (const id of PREVIEW_SCENARIOS) expect(isPreviewScenario(id)).toBe(true);
    expect(isPreviewScenario('nope')).toBe(false);
    expect(Object.keys(en.preview.scenario)).toHaveLength(PREVIEW_SCENARIOS.length);
    expect(Object.keys(de.preview.scenario)).toHaveLength(PREVIEW_SCENARIOS.length);
    expect(Object.values(de.preview.scenario).every((v) => v.length > 0)).toBe(true);
  });

  it.each(PREVIEW_SCENARIOS)('%s builds a consistent, JSON-safe snapshot', (id) => {
    const s = build(id);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const dto = s.init.snapshot;
    expect(dto).not.toBeNull();
    if (!dto) return;
    // Every taken line is LINE_TAKEN for the viewer; every pick's line is taken by its picker.
    for (const [lineId, owner] of Object.entries(dto.taken)) {
      expect(dto.viewer.line_status[lineId]).toEqual({ code: 'LINE_TAKEN', params: { player_id: owner } });
    }
    for (const p of dto.picks) expect(dto.taken[p.line_id]).toBe(p.player_id);
    // Budgets never go negative; the adapter accepts the snapshot.
    for (const p of dto.participants) expect(p.budget_remaining).toBeGreaterThanOrEqual(0);
    expect(toDraftViewModel(dto).version).toBe(dto.state_version);
  });

  it('live-my-turn: Dawn is on the clock, Misty not next, expensive lines are budget-infeasible', () => {
    const dto = build('live-my-turn').init.snapshot;
    const vm = dto ? toDraftViewModel(dto) : null;
    expect(vm?.viewerOnClock).toBe(true);
    expect(dto?.viewer.pick_block).toBeNull();
    const codes = new Set(Object.values(dto?.viewer.line_status ?? {}).map((r) => r.code));
    expect(codes).toEqual(new Set(['LINE_TAKEN', 'BUDGET_INFEASIBLE']));
  });

  it('live-up-next and live-waiting: the viewer is next / not on the clock', () => {
    const next = build('live-up-next').init.snapshot;
    expect(next && toDraftViewModel(next).viewerUpNext).toBe(true);
    const waiting = build('live-waiting').init.snapshot;
    expect(waiting?.viewer.pick_block).toEqual({ code: 'NOT_YOUR_TURN' });
  });

  it('live-paused freezes the clock; no scenario has a blocked slot any more', () => {
    const paused = build('live-paused').init.snapshot;
    expect(paused?.pool.paused).toBe(true);
    expect(paused?.active_slot?.remaining_ms_at_pause).toBe(154_000);
    expect(paused?.viewer.pick_block?.code).toBe('DRAFT_PAUSED');
    expect(PREVIEW_SCENARIOS as readonly string[]).not.toContain('live-blocked');
    for (const id of PREVIEW_SCENARIOS) {
      const dto = build(id).init.snapshot;
      expect(dto?.active_slot?.status ?? 'active', id).toBe('active');
      expect(dto?.pool.pause_reason ?? null, id).not.toBe('blocked_slot');
    }
  });

  it('live-makeup shows the snake-turn example: Misty on the clock, then Dawn, then the Misty make-up', () => {
    const dto = build('live-makeup').init.snapshot;
    expect(dto?.active_slot?.player_id).toBe(MISTY);
    expect(dto?.upcoming.slice(0, 2).map((u) => [u.player_id, u.kind])).toEqual([
      [DAWN, 'normal'],
      [MISTY, 'makeup'],
    ]);
    expect(dto?.upcoming[1].duration_ms).toBe(150_000);
  });

  it('every draft uses the pack budget', () => {
    expect(build('live-my-turn').init.snapshot?.pool.budget).toBe(epbPack.defaults.draftBudget);
  });

  it('slow-my-turn: the deadline is 7 h 42 m ahead; slow-penalty: stages 1–3', () => {
    const slow = build('slow-my-turn').init.snapshot;
    expect(slow?.pool.mode).toBe('slow');
    expect(Date.parse(slow?.active_slot?.deadline_at ?? '') - NOW).toBe(7 * 3_600_000 + 42 * 60_000);
    const penalty = build('slow-penalty').init.snapshot;
    expect(new Set(penalty?.participants.map((p) => p.penalty_stage))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('redraft: submission phase, reveal publishes drops, picking has the earlier slots open and the last filled', () => {
    expect(build('redraft-submission').init.snapshot?.viewer.pick_block).toEqual({ code: 'SUBMISSION_PHASE' });
    expect(build('redraft-submission').init.redraftSubmission?.locked).toBe(false);
    expect(build('redraft-submission').init.redraftSubmission?.max).toBe(epbPack.defaults.redraftMaxLines);
    expect(build('redraft-locked').init.redraftSubmission?.locked).toBe(true);
    expect(build('redraft-reveal').init.snapshot?.redraft?.drops?.length).toBeGreaterThan(3);
    const picking = build('redraft-picking').init.snapshot;
    expect(picking?.active_slot?.player_id).toBe(DAWN);
    const slots = picking?.redraft?.viewer_slots ?? [];
    expect(slots.length).toBe(Math.min(3, epbPack.defaults.redraftMaxLines));
    expect(slots.map((s) => s.filled_by_pick_id === null)).toEqual(slots.map((_, i) => i < slots.length - 1));
    expect(picking?.viewer.line_status['charmander--charizard']?.code).toBe('OWN_REDRAFT_DROP');
  });

  it('viewer variants: complete, spectator, signed-out', () => {
    expect(build('complete').init.snapshot?.pool.status).toBe('complete');
    expect(build('spectator').init.snapshot?.viewer.pick_block).toEqual({ code: 'NOT_PARTICIPANT' });
    expect(build('signed-out').init.snapshot?.viewer.pick_block).toEqual({ code: 'SIGNED_OUT' });
  });

  it('admin-panel: an initial pool (complete) and a picking redraft whose admin snapshot carries every slot', () => {
    const s = build('admin-panel');
    expect(s.screen).toBe('admin');
    const pools = s.admin?.pools ?? [];
    expect(pools.map((p) => [p.summary.kind, p.summary.status])).toEqual([
      ['initial', 'complete'],
      ['redraft', 'in_progress'],
    ]);
    expect(new Set(pools.map((p) => p.summary.id)).size).toBe(2);
    expect(s.poolId).toBe(pools[1].summary.id);
    const dto = s.init.snapshot;
    expect(dto?.viewer.is_pool_admin).toBe(true);
    expect(dto?.viewer.active_player_line_status).toBeDefined();
    const slots = dto?.redraft?.admin_slots ?? [];
    expect(slots.length).toBe(dto?.redraft?.drops?.length);
    expect(new Set(slots.map((x) => x.redraft_slot_id)).size).toBe(slots.length);
    // Every redraft pick fills exactly one slot of its picker.
    for (const pick of dto?.picks ?? []) {
      const slot = slots.find((x) => x.filled_by_pick_id === pick.pick_id);
      expect(slot?.player_id, pick.pick_id).toBe(pick.player_id);
      expect(pick.redraft_slot_id).toBe(slot?.redraft_slot_id);
    }
    expect(s.admin?.participants).toHaveLength(6);
    expect(Object.keys(s.admin?.participants[0] ?? {})).toEqual(['id', 'name']);
  });

  it('many-drafted has most lines taken; token and audit scenarios carry their fixture data', () => {
    expect(Object.keys(build('many-drafted').init.snapshot?.taken ?? {})).toHaveLength(MANY_DRAFTED);
    const open = build('tokens-open').init.tokens;
    expect(open?.draft_kill.window).toBe('open');
    expect(open?.draft_kill.cost).toBe(epbPack.defaults.tokenRatio);
    expect(open?.draft_kill.max).toBe(epbPack.defaults.tokenMax);
    expect(open?.cosmo?.line_id).toBe(PREVIEW_PARTICIPATION_LINE);
    // Three shutouts at the first comeback row, one token spent.
    const row = epbPack.comeback.table[0];
    expect(build('tokens-comeback').init.tokens?.comeback.unspent).toBe(3 * row.tokens - 1);
    expect(build('admin-audit').init.audit?.length).toBeGreaterThan(3);
  });

  it('maps every scenario to its real screen', () => {
    const expected: Record<string, PreviewScreen> = {
      'redraft-submission': 'redraft',
      'redraft-locked': 'redraft',
      'redraft-reveal': 'redraft',
      'tokens-before': 'tokens',
      'tokens-open': 'tokens',
      'tokens-comeback': 'tokens',
      'admin-panel': 'admin',
      'admin-publish-refused': 'admin',
      'admin-tokens': 'tokenAdmin',
      'admin-audit': 'audit',
    };
    for (const id of PREVIEW_SCENARIOS) expect(build(id).screen, id).toBe(expected[id] ?? 'pick');
    expect(JSON.stringify(build('admin-panel'))).not.toContain('pending');
  });

  it('admin-room / admin-room-sheet: the room for a pool admin while someone else is on the clock', () => {
    for (const id of ['admin-room', 'admin-room-sheet'] as const) {
      const dto = build(id).init.snapshot;
      expect(dto?.viewer.is_pool_admin, id).toBe(true);
      expect(dto?.active_slot?.player_id, id).not.toBe(dto?.viewer.player_id);
    }
    expect(build('admin-room').preset).toBeNull();
    const sheet = build('admin-room-sheet');
    expect(sheet.preset?.adminTab).toBe('live');
    expect(sheet.init.snapshot?.pool.paused).toBe(true);
  });

  it('admin-room-refused: the room sheet opens on Redraft and its submissions read carries the refusal', async () => {
    const refused = build('admin-room-refused');
    expect(refused.screen).toBe('pick');
    expect(refused.preset?.adminTab).toBe('redraft');
    expect(refused.init.snapshot?.viewer.is_pool_admin).toBe(true);
    expect(refused.init.snapshot?.redraft?.phase).toBe('locked');
    // Admin data comes from the admin read, never from the snapshot seed.
    expect(JSON.stringify(refused.init.snapshot)).not.toContain(refused.init.adminPublishRefusedAt ?? '-');
    const src = createFakeDataSource({ ...refused.init, latencyMs: 0 });
    const res = await src.submissions();
    expect(res.ok && res.data.publish_refused_at).toBe(refused.init.adminPublishRefusedAt);
    // The control-page twin answers the same instant, so its live read keeps the server render's notice.
    const panel = build('admin-publish-refused');
    const panelRead = await createFakeDataSource({ ...panel.init, latencyMs: 0 }).submissions();
    expect(panelRead.ok && panelRead.data.publish_refused_at).toBe(Object.values(panel.admin?.publishRefusedAt ?? {})[0]);
  });

  it('presets: reasons pin an infeasible line; filters and the dialog are preset finder state', () => {
    const reasons = build('live-reasons');
    expect(reasons.init.snapshot?.viewer.line_status[reasons.preset?.pinnedLineId ?? '']?.code).toBe('BUDGET_INFEASIBLE');
    const filters = build('live-filters').preset;
    const view = presetView(filters ?? {});
    expect(view.filters.types.ids).toEqual(['Water']);
    expect(view.pinnedLineId).toBe(PREVIEW_PRESET_LINES.filters);
    // The sheet starts open with untouched group state: the active groups open on first render.
    expect(view.filterPanelOpen).toBe(true);
    expect(view.filterSheet.openGroups).toBeNull();
    expect(openFilterGroups(view.filterSheet, view.filters)).toEqual(['pokemon', 'movesAbilities', 'defense']);
    expect(activeFilterCount(view.filters)).toBe(3);
    expect(build('live-confirm').preset?.dialog).toBe(true);
    const wall = presetView(build('live-wall').preset ?? {});
    expect(wall.pinnedLineId).toBe(PREVIEW_WALL_PIN);
    expect(wall.filters.maxPrice).toBe(PREVIEW_WALL_MAX_PRICE);
    expect(wall.tab).toBe('all');
  });
});

describe('createFakeDataSource', () => {
  const signal = new AbortController().signal;

  it('answers unchanged for the current version and the full snapshot otherwise', async () => {
    const s = build('live-my-turn');
    const src = createFakeDataSource({ ...s.init, latencyMs: 0 });
    const v = s.init.snapshot?.state_version ?? 0;
    expect((await src.fetchSnapshot(v, signal)).kind).toBe('unchanged');
    expect((await src.fetchSnapshot(null, signal)).kind).toBe('full');
  });

  it('records a pick, advances the clock, bumps the version and replays the same request id', async () => {
    const s = build('live-my-turn');
    const src = createFakeDataSource({ ...s.init, latencyMs: 0 });
    const before = s.init.snapshot;
    const slotId = before?.active_slot?.slot_id ?? '';
    const res = await src.postPick({ slot_id: slotId, line_id: CONFIRM_LINE, client_request_id: 'req-1' });
    expect(res.ok).toBe(true);
    if (!res.ok || !before || !res.data.snapshot) throw new Error('pick should succeed with a snapshot');
    const after = res.data.snapshot;
    expect(after.state_version).toBe(before.state_version + 1);
    expect(after.taken[CONFIRM_LINE]).toBe(DAWN);
    expect(after.active_slot?.slot_id).toBe(before.upcoming[0].slot_id);
    expect(after.participants.find((p) => p.player_id === DAWN)?.budget_remaining).toBe(
      (before.participants.find((p) => p.player_id === DAWN)?.budget_remaining ?? 0) -
        (PREVIEW_ENTRIES.find((e) => e.line_id === CONFIRM_LINE)?.price ?? Number.NaN),
    );
    expect(after.viewer.pick_block).toEqual({ code: 'NOT_YOUR_TURN' });
    const again = await src.postPick({ slot_id: slotId, line_id: CONFIRM_LINE, client_request_id: 'req-1' });
    expect(again.ok && again.data.replay).toBe(true);
    const stale = await src.postPick({ slot_id: slotId, line_id: FREE_LINE, client_request_id: 'req-2' });
    expect(stale.ok ? null : stale.error.code).toBe('STALE_SLOT');
  });

  it('refuses a taken line and a pick while paused', async () => {
    const s = build('live-my-turn');
    const src = createFakeDataSource({ ...s.init, latencyMs: 0 });
    const takenLine = Object.keys(s.init.snapshot?.taken ?? {})[0];
    const slotId = s.init.snapshot?.active_slot?.slot_id ?? '';
    const res = await src.postPick({ slot_id: slotId, line_id: takenLine, client_request_id: 'r' });
    expect(res.ok ? null : res.error.code).toBe('LINE_TAKEN');
    const paused = build('live-paused');
    const pausedSrc = createFakeDataSource({ ...paused.init, latencyMs: 0 });
    const p = await pausedSrc.postPick({ slot_id: paused.init.snapshot?.active_slot?.slot_id ?? '', line_id: FREE_LINE, client_request_id: 'r' });
    expect(p.ok ? null : p.error.code).toBe('DRAFT_PAUSED');
  });

  it('applies an extension once', async () => {
    const s = build('live-my-turn');
    const src = createFakeDataSource({ ...s.init, latencyMs: 0 });
    const slotId = s.init.snapshot?.active_slot?.slot_id ?? '';
    const first = await src.postExtension('plus120', slotId);
    expect(first.ok && Date.parse(first.data.deadline_at) - Date.parse(s.init.snapshot?.active_slot?.deadline_at ?? '')).toBe(120_000);
    const second = await src.postExtension('plus120', slotId);
    expect(second.ok ? null : second.error.code).toBe('EXTENSION_USED');
  });

  it('fills the chosen redraft slot and keeps favourites and submissions in memory', async () => {
    const s = build('redraft-picking');
    const src = createFakeDataSource({ ...s.init, latencyMs: 0 });
    const slotId = s.init.snapshot?.active_slot?.slot_id ?? '';
    const free = Object.keys(s.init.snapshot?.viewer.line_status ?? {});
    const line = PREVIEW_ENTRIES.map((e) => e.line_id ?? '').find((id) => !free.includes(id)) ?? '';
    // With several open slots the slot must be named. The pack's redraft cap may leave the fixture
    // with one open slot, so this state always gets a second one.
    const snapshot = s.init.snapshot;
    const redraft = snapshot?.redraft;
    if (!snapshot || !redraft) throw new Error('redraft-picking has no redraft snapshot');
    const openSlots = redraft.viewer_slots.filter((x) => x.filled_by_pick_id === null);
    const extraSlots =
      openSlots.length > 1
        ? []
        : [{ ...redraft.viewer_slots[0], redraft_slot_id: 'preview-redraft-slot-extra', label: 'Z', filled_by_pick_id: null }];
    const multi = createFakeDataSource({
      ...s.init,
      latencyMs: 0,
      snapshot: { ...snapshot, redraft: { ...redraft, viewer_slots: [...redraft.viewer_slots, ...extraSlots] } },
    });
    const missing = await multi.postPick({ slot_id: slotId, line_id: line, client_request_id: 'a' });
    expect(missing.ok ? null : missing.error.code).toBe('REDRAFT_SLOT_REQUIRED');
    const ok = await src.postPick({ slot_id: slotId, line_id: line, client_request_id: 'b', redraft_slot_id: 'preview-redraft-slot-A' });
    expect(ok.ok && ok.data.snapshot?.redraft?.viewer_slots[0].filled_by_pick_id).toBeTruthy();

    const fav = await src.setFavorite(FREE_LINE, true);
    expect(fav.ok && fav.data).toContain(FREE_LINE);
    expect(await src.getFavorites()).toContain(FREE_LINE);

    const subInit = build('redraft-submission').init;
    const sub = createFakeDataSource({ ...subInit, latencyMs: 0 });
    const droppable = (subInit.redraftSubmission?.own_lines ?? []).filter((l) => l.droppable).map((l) => l.line_id);
    const tooMany = await sub.putSubmission(droppable.slice(0, epbPack.defaults.redraftMaxLines + 1));
    expect(tooMany.ok ? null : tooMany.error.code).toBe('REDRAFT_MAX_EXCEEDED');
    const locked = await sub.putSubmission([PREVIEW_PARTICIPATION_LINE ?? '']);
    expect(locked.ok ? null : locked.error.code).toBe('LINE_NOT_DROPPABLE');
    const saved = await sub.putSubmission(['charmander--charizard', 'pawmi--pawmot']);
    expect(saved.ok && saved.data.line_ids).toEqual(['charmander--charizard', 'pawmi--pawmot']);
  });

  it("an admin's on-behalf Redraft pick fills one of the ACTIVE player's slots, never the admin's own", async () => {
    const s = build('admin-panel');
    const snapshot = s.init.snapshot;
    const active = snapshot?.active_slot;
    const adminSlots = snapshot?.redraft?.admin_slots;
    if (!snapshot || !active || !adminSlots) throw new Error('admin-panel has a picking redraft with admin slots');
    const viewerId = snapshot.viewer.player_id;
    // Another player with exactly one open slot takes the clock.
    const target = snapshot.participants.find(
      (p) => p.player_id !== viewerId && adminSlots.filter((x) => x.player_id === p.player_id && x.filled_by_pick_id === null).length === 1,
    );
    if (!target) throw new Error('admin-panel has another player with one open redraft slot');
    const targetSlot = adminSlots.find((x) => x.player_id === target.player_id && x.filled_by_pick_id === null);
    const ownOpen = adminSlots.find((x) => x.player_id === viewerId && x.filled_by_pick_id === null);
    const taken = new Set(Object.keys(snapshot.taken));
    const line = PREVIEW_ENTRIES.map((e) => e.line_id ?? '').find((id) => id !== '' && !taken.has(id) && (PREVIEW_ENTRIES.find((e) => e.line_id === id)?.price ?? Infinity) <= target.budget_remaining) ?? '';
    const make = () =>
      createFakeDataSource({ ...s.init, latencyMs: 0, snapshot: { ...snapshot, active_slot: { ...active, player_id: target.player_id } } });
    const behalf = { slot_id: active.slot_id, line_id: line, on_behalf_of: target.player_id, override_reason: 'absent player' };

    if (ownOpen) {
      const own = await make().postPick({ ...behalf, client_request_id: 'own', redraft_slot_id: ownOpen.redraft_slot_id });
      expect(own.ok ? null : own.error.code).toBe('REDRAFT_SLOT_FILLED');
    }
    const ok = await make().postPick({ ...behalf, client_request_id: 'target', redraft_slot_id: targetSlot?.redraft_slot_id });
    expect(ok.ok ? null : ok.error.code).toBeNull();
    const filled = ok.ok ? ok.data.snapshot?.redraft?.admin_slots?.find((x) => x.redraft_slot_id === targetSlot?.redraft_slot_id) : undefined;
    expect(filled?.filled_by_pick_id).toBeTruthy();
  });

  it('buys a Draft Kill Token only while the window is open', async () => {
    const openInit = build('tokens-open').init;
    const open = createFakeDataSource({ ...openInit, latencyMs: 0 });
    const res = await open.buyDraftKill('pawmi--pawmot', 'r1');
    expect(res.ok && res.data.draft_kill.owned).toBe((openInit.tokens?.draft_kill.owned ?? 0) + 1);
    const before = createFakeDataSource({ ...build('tokens-before').init, latencyMs: 0 });
    const closed = await before.buyDraftKill('pawmi--pawmot', 'r2');
    expect(closed.ok ? null : closed.error.code).toBe('TOKEN_WINDOW_CLOSED');
  });
});

describe('fake AdminDraftActions (in memory, bumps state_version)', () => {
  const signal = new AbortController().signal;

  async function versionOf(src: ReturnType<typeof createFakeDataSource>): Promise<number> {
    const res = await src.fetchSnapshot(null, signal);
    if (res.kind !== 'full') throw new Error('no snapshot');
    return res.dto.state_version;
  }

  it('pauses, refuses a second pause, voids and corrects only while paused, resumes', async () => {
    const s = build('live-my-turn');
    const src = createFakeDataSource({ ...s.init, latencyMs: 0 });
    const v0 = await versionOf(src);
    const firstPick = s.init.snapshot?.picks[0];
    if (!firstPick) throw new Error('no pick');
    const early = await src.voidPick(firstPick.pick_id, 'test');
    expect(early.ok ? null : early.error.code).toBe('CORRECTION_REQUIRES_PAUSE');
    const paused = await src.pause(true, 'test');
    expect(paused.ok && paused.data.state_version).toBe(v0 + 1);
    const again = await src.pause(true);
    expect(again.ok ? null : again.error.code).toBe('ALREADY_PAUSED');
    const corrected = await src.correctPick(firstPick.pick_id, CONFIRM_LINE, 'test', 'req', undefined);
    expect(corrected.ok).toBe(true);
    const voided = await src.voidPick(firstPick.pick_id, 'test');
    expect(voided.ok).toBe(true);
    const snap = await src.fetchSnapshot(null, signal);
    if (snap.kind !== 'full') throw new Error('no snapshot');
    expect(snap.dto.picks.some((p) => p.pick_id === firstPick.pick_id)).toBe(false);
    expect(snap.dto.taken[CONFIRM_LINE]).toBeUndefined();
    expect(snap.dto.upcoming[0].slot_id).toBe(`${firstPick.slot_id}-requeue`);
    const resumed = await src.pause(false);
    expect(resumed.ok && resumed.data.state_version).toBe(v0 + 4);
  });

  it('serves submissions, publishes once, restores an unfilled drop, toggles Comeback spending', async () => {
    const sub = build('redraft-locked');
    const locked = createFakeDataSource({ ...sub.init, adminSubmissions: [{ player_id: DAWN, player_name: 'Dawn', line_ids: ['charmander--charizard'], updated_at: new Date(NOW).toISOString() }], latencyMs: 0 });
    const list = await locked.submissions();
    expect(list.ok && list.data.submissions.map((x) => x.player_id)).toEqual([DAWN]);
    expect(list.ok && list.data.publish_refused_at).toBeNull();
    const published = await locked.publishRedraft({ force: true, reason: 'test' });
    expect(published.ok && published.data.drops).toBe(1);
    const twice = await locked.publishRedraft({ force: true });
    expect(twice.ok ? null : twice.error.code).toBe('SUBMISSIONS_ALREADY_PUBLISHED');

    const admin = build('admin-panel');
    const src = createFakeDataSource({ ...admin.init, latencyMs: 0 });
    const open = admin.init.snapshot?.redraft?.admin_slots?.find((x) => x.filled_by_pick_id === null && x.player_id !== DAWN);
    if (!open) throw new Error('no open slot');
    const restored = await src.restoreDrop(open.redraft_slot_id, 'test');
    expect(restored.ok).toBe(true);
    const filled = admin.init.snapshot?.redraft?.admin_slots?.find((x) => x.filled_by_pick_id !== null);
    if (!filled) throw new Error('no filled slot');
    const refused = await src.restoreDrop(filled.redraft_slot_id, 'test');
    expect(refused.ok ? null : refused.error.code).toBe('REDRAFT_SLOT_FILLED');
    const comeback = await src.setComebackOpen(true);
    expect(comeback.ok && comeback.data.open).toBe(true);
    const overview = await src.overview(DAWN);
    expect(overview.ok && overview.data.comeback.spend_open).toBe(true);
  });

  it('answers the audit query from the fixture rows', async () => {
    const s = build('admin-audit');
    const entries = s.init.audit ?? [];
    const q = auditQueryString({ actions: ['paused', 'resumed'], player: null, limit: 50 });
    expect(auditQueryFrom(q)).toEqual({ actions: ['paused', 'resumed'], player: null, cursor: null, limit: 50 });
    expect(filterAudit(entries, auditQueryFrom(q)).map((e) => e.action)).toEqual(['resumed', 'paused']);
    const src = createFakeDataSource({ ...s.init, latencyMs: 0 });
    const page = await src.audit({ player: MISTY });
    expect(page.ok && page.data.entries.map((e) => e.id)).toEqual(['audit-2']);
    expect(page.ok && page.data.next_cursor).toBeNull();
  });
});

describe('rendering (no network, EN + DE)', () => {
  let index: DraftSearchIndex;
  beforeAll(async () => {
    index = (await buildDraftSearchIndex(PREVIEW_LIST_VERSION_ID, PREVIEW_ENTRIES)).index;
  }, 60_000);

  const links = { redraft: '/draft-preview?scenario=redraft-submission', tokens: '/draft-preview?scenario=tokens-open', admin: null, adminAudit: null, trainerCreator: '/draft-room/trainer-creator' };
  const screenLinks = {
    redraftRoom: '/draft-preview?scenario=redraft-picking',
    adminRoom: '/draft-preview?scenario=live-my-turn#',
    adminAudit: '/draft-preview?scenario=admin-audit#',
  };

  beforeEach(() => {
    mounts.list.length = 0;
  });

  function render(id: (typeof PREVIEW_SCENARIOS)[number], locale: 'en' | 'de'): string {
    const catalog = buildLineCatalog(PREVIEW_ENTRIES, [], DEFAULT_BANNED_MOVES, locale);
    return renderWithI18n(
      <PreviewClient
        scenario={build(id)}
        seasonId="preview-season"
        leagueName="EvoLiga Preview"
        catalog={catalog}
        index={index}
        links={links}
        screenLinks={screenLinks}
      />,
      { locale, requestTime: NOW },
    );
  }

  /** The real screen each scenario must mount (presets go into the draft room's client as props). */
  const SCREEN_COMPONENT: Record<PreviewScreen, string> = {
    pick: 'DraftToolClient',
    redraft: 'RedraftCenter',
    tokens: 'TokenCenter',
    admin: 'DraftControlPanel',
    audit: 'DraftAuditViewer',
    tokenAdmin: 'TokenAdminSummary',
  };

  function expectedMount(id: (typeof PREVIEW_SCENARIOS)[number]): string {
    return SCREEN_COMPONENT[build(id).screen];
  }

  it.each(PREVIEW_SCENARIOS)('%s mounts its real screen in English and German', (id) => {
    for (const locale of ['en', 'de'] as const) {
      mounts.list.length = 0;
      const html = render(id, locale);
      const small = id === 'redraft-submission' || id === 'redraft-locked' || id.startsWith('tokens-') || id === 'admin-tokens';
      expect(html.length).toBeGreaterThan(small ? 20 : 1000);
      expect(mounts.list[0]?.name, `${id} ${locale}`).toBe(expectedMount(id));
      expect(html).not.toContain('{&quot;');
    }
  });

  it('injects the in-memory backend into every real screen (no HTTP default is reachable)', async () => {
    render('redraft-reveal', 'en');
    const redraft = mounts.list.find((m) => m.name === 'RedraftCenter')?.props;
    expect(redraft?.dataSource).toBeDefined();
    expect(redraft?.redraftSource).toBe(redraft?.dataSource);
    expect(redraft?.links).toEqual({ room: screenLinks.redraftRoom });

    mounts.list.length = 0;
    render('tokens-open', 'en');
    expect(mounts.list.find((m) => m.name === 'TokenCenter')?.props.source).toBeDefined();

    mounts.list.length = 0;
    const html = render('admin-panel', 'de');
    const panel = mounts.list.find((m) => m.name === 'DraftControlPanel')?.props;
    const s = build('admin-panel');
    const dataSourceFor = panel?.dataSourceFor as (poolId: string) => ReturnType<typeof createFakeDataSource>;
    const actionsFor = panel?.actionsFor as (poolId: string) => ReturnType<typeof createFakeDataSource>;
    // Tokens live on the league admin page's Draft tab only: the panel links there and has no token props.
    expect(panel).not.toHaveProperty('tokenSource');
    expect(panel).not.toHaveProperty('participants');
    expect(mounts.list.find((m) => m.name === 'TokenAdminSummary')).toBeUndefined();
    expect(html).toContain('Liga-Verwaltung: Draft');
    expect(Object.keys(panel?.initialSnapshots as object)).toEqual(s.admin?.pools.map((p) => p.summary.id));
    for (const pool of s.admin?.pools ?? []) {
      const res = await dataSourceFor(pool.summary.id).fetchSnapshot(null, new AbortController().signal);
      expect(res.kind === 'full' && res.dto.pool.id).toBe(pool.summary.id);
    }
    const write = await actionsFor(s.poolId).pause(true, 'preview');
    expect(write.ok).toBe(true);
    // The redraft tab opens first.
    expect(html).toContain('Redraft');

    // admin-tokens: the token summary as the league admin page's Draft tab shows it, on the fake.
    mounts.list.length = 0;
    const tokensHtml = render('admin-tokens', 'de');
    const summary = mounts.list.find((m) => m.name === 'TokenAdminSummary')?.props;
    expect(summary?.source).toBeDefined();
    expect(summary?.participants).toEqual(build('admin-tokens').admin?.participants);
    // The Comeback switch renders (it writes through the fake, never BE #28 over HTTP).
    expect(tokensHtml).toContain('Einsatz von Comeback-Tokens erlauben');
    const setOpen = summary?.setComebackOpen as (open: boolean) => Promise<{ ok: boolean }>;
    expect((await setOpen(true)).ok).toBe(true);

    // admin-publish-refused: the control page's admin data reaches the Redraft section. The refusal has one read
    // path (`draft-publish-refusals.ts`); the snapshot DTO has no refusal field at all (src/lib/draft/__tests__/snapshot.test.ts).
    mounts.list.length = 0;
    const refusedEn = render('admin-publish-refused', 'en');
    const refused = build('admin-publish-refused');
    const refusedPanel = mounts.list.find((m) => m.name === 'DraftControlPanel')?.props;
    expect(refusedPanel?.publishRefusedAt).toEqual(refused.admin?.publishRefusedAt);
    expect(refusedEn).toContain('Automatic publish refused at');
    expect(JSON.stringify(refused.init.snapshot)).not.toContain('publish_refused');
    expect(render('admin-publish-refused', 'de')).toContain('Automatische Veröffentlichung abgelehnt am');

    // live-index-loading / live-index-failed: no server index reaches the room, under their own index URL.
    for (const id of ['live-index-loading', 'live-index-failed'] as const) {
      mounts.list.length = 0;
      const indexHtml = render(id, 'en');
      const room = mounts.list.find((m) => m.name === 'DraftToolClient')?.props;
      expect(room?.initialIndex, id).toBeUndefined();
      expect(String(room?.indexUrl), id).toContain(id === 'live-index-loading' ? 'pending' : 'failed');
      // Catalog totals in the tabs, no matching/total, the Filters button disabled while there is no index.
      expect(indexHtml, id).toContain('role="tablist"');
      expect(indexHtml, id).not.toMatch(/>\d+\/\d+</);
      expect(indexHtml, id).toContain('motion-safe:animate-pulse');
    }
    const pending = createFakeDataSource({ ...build('live-index-loading').init, index });
    const settled = await Promise.race([
      pending.fetchIndex('x').then(() => 'resolved', () => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 400)),
    ]);
    expect(settled).toBe('pending');
    const failing = createFakeDataSource({ ...build('live-index-failed').init, index });
    await expect(failing.fetchIndex('x')).rejects.toBeDefined();

    // live-filters-more: the sheet with a stat threshold and a picked utility member.
    mounts.list.length = 0;
    const moreHtml = render('live-filters-more', 'en');
    const more = mounts.list.find((m) => m.name === 'DraftToolClient')?.props.initialView as {
      filters: { stats: Record<string, number>; utility: { members: string[] }[] };
      filterPanelOpen: boolean;
    };
    expect(more.filterPanelOpen).toBe(true);
    expect(more.filters.stats).toEqual({ spe: 80, bst: 500 });
    expect(more.filters.utility).toHaveLength(1);
    expect(more.filters.utility[0].members).toHaveLength(1);
    // Two stat thresholds, plus one chip for the picked member (the category chip is not shown beside it).
    expect(moreHtml).toContain('Filters (3)');

    // Presets reach the draft room's client as preview props (no separate harness).
    mounts.list.length = 0;
    render('live-filters', 'en');
    const filtersProps = mounts.list.find((m) => m.name === 'DraftToolClient')?.props;
    expect((filtersProps?.initialView as { filters: { types: { ids: string[] } } }).filters.types.ids).toEqual(['Water']);
    expect((filtersProps?.initialView as { filterPanelOpen: boolean }).filterPanelOpen).toBe(true);
    expect(filtersProps?.initialConfirmLineId).toBeUndefined();
    mounts.list.length = 0;
    render('live-confirm', 'en');
    const confirmProps = mounts.list.find((m) => m.name === 'DraftToolClient')?.props;
    expect(confirmProps?.initialConfirmLineId).toBe(CONFIRM_LINE);
    expect((confirmProps?.initialView as { pinnedLineId: string }).pinnedLineId).toBe(CONFIRM_LINE);
    mounts.list.length = 0;
    render('live-my-turn', 'en');
    expect(mounts.list.find((m) => m.name === 'DraftToolClient')?.props.initialView).toBeUndefined();

    mounts.list.length = 0;
    render('admin-audit', 'en');
    const viewer = mounts.list.find((m) => m.name === 'DraftAuditViewer')?.props;
    const loadPage = viewer?.loadPage as (poolId: string, query: string) => Promise<{ ok: boolean }>;
    expect(await loadPage(build('admin-audit').poolId, auditQueryString({ limit: 50 }))).toMatchObject({ ok: true });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the on-clock banner, the pause banner and owner names', () => {
    expect(render('live-my-turn', 'en')).toContain('You are on the clock');
    expect(render('live-my-turn', 'de')).toContain('Du bist am Zug');
    expect(render('live-paused', 'en')).toContain('Draft paused');
    expect(render('live-paused', 'de')).toContain('Draft pausiert');
    expect(render('many-drafted', 'en')).toContain('Serena');
  });

  it('live-wall: branched and unbranched cards share one card skeleton under the pinned price tabs', () => {
    for (const locale of ['en', 'de'] as const) {
      const html = render('live-wall', locale);
      // Mixed lines: cards with a footer (the final stage) and cards whose footer slot is an empty placeholder.
      expect(html).toContain('data-branch="true"');
      expect(html).toContain('data-branch="false"');
      expect(html.split('data-card-row="footer"').length).toBe(html.split('role="option"').length);
      expect(html.split('data-card-row="head"').length).toBe(html.split('role="option"').length);
      // The tabs come before the grid (pinned on top), with matching/total counts while the price filter is on.
      const tablist = html.indexOf('role="tablist"');
      expect(tablist).toBeGreaterThan(-1);
      expect(tablist).toBeLessThan(html.indexOf('role="listbox"'));
      expect(html).toMatch(/>\d+\/\d+</);
      // The pinned branched line.
      expect(html).toMatch(new RegExp(`aria-selected="true"[^>]*data-line-id="${PREVIEW_WALL_PIN}"`));
    }
  });
});

describe('isolation', () => {
  it('no preview file imports Supabase or calls fetch', () => {
    const dir = join(__dirname, '..');
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf-8');
      expect(src, f).not.toMatch(/@\/lib\/supabase|from '@supabase|\bfetch\(/);
    }
  });
});
