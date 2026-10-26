/**
 * The draft room's admin sheet (W3, owner feedback 2026-10-18): tabs per
 * admin section, one poller (the room's snapshot), lazy tab data, the
 * "Pick for the active player" hand-off to the room's override switch, and
 * nested dialogs stacked inside the sheet.
 *
 * Static render (vitest 'node' env, no DOM): Radix is mocked so every dialog
 * renders inline; a `data-dialog` wrapper marks each Root with its `open`
 * flag, so the nesting of the armed confirms inside the sheet is visible in
 * the markup. Real focus movement and Escape are Radix's job (checked by the
 * lead in the browser); here the handlers and the tree shape are checked.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { DAWN, MISTY, snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftSnapshotDTO } from '@/types/draft-queue';
import type { AdminDraftActions } from '../admin-actions';

const captured = vi.hoisted(() => ({ contents: [] as Record<string, unknown>[] }));
const polls = vi.hoisted(() => ({ calls: 0 }));

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ open, children }: { open: boolean; children: ReactNode }) => (
    <div data-dialog={open ? 'open' : 'closed'}>{children}</div>
  ),
  Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Overlay: () => null,
  Content: (props: Record<string, unknown> & { children?: ReactNode }) => {
    captured.contents.push(props);
    return <div role="dialog">{props.children}</div>;
  },
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Close: ({ children, ...rest }: { children: ReactNode }) => (
    <button type="button" {...rest}>
      {children}
    </button>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/leagues/s/draft-room' }));
// One poller: the sheet must never start its own snapshot poll.
vi.mock('@/components/draft-tool/hooks/use-draft-snapshot', () => ({
  useDraftSnapshot: () => {
    polls.calls += 1;
    throw new Error('the admin sheet must read the room snapshot, not poll');
  },
}));

import RoomAdminSheet, { type RoomAdminSheetProps } from '../RoomAdminSheet';
import { poolAdminSections, redraftSubmissionsRead, REFUSAL_WATCH_MS, settle, shownPublishRefusal } from '../pool-admin';
import { isAdminRedraftSubmissions } from '../admin-actions';

const CATALOG: DraftLineCatalog = { listVersionId: 'list-1', bannedMoves: [], lines: [] };

function fakeActions(): AdminDraftActions & { calls: string[] } {
  const calls: string[] = [];
  const ok = (name: string) => async () => {
    calls.push(name);
    return { ok: true as const, data: { state_version: 43 } };
  };
  return {
    calls,
    createRedraft: async () => ({ ok: true, data: { pool_id: 'r1' } }),
    saveConfig: ok('saveConfig'),
    patchRedraft: ok('patchRedraft'),
    start: ok('start'),
    end: ok('end'),
    pause: ok('pause'),
    voidPick: ok('voidPick'),
    correctPick: ok('correctPick'),
    setPenalty: ok('setPenalty'),
    submissions: async () => {
      calls.push('submissions');
      return { ok: true, data: { submissions: [], publish_refused_at: null } };
    },
    publishRedraft: async () => ({ ok: true, data: { state_version: 43, drops: 0 } }),
    restoreDrop: ok('restoreDrop'),
    setComebackOpen: async () => ({ ok: true, data: { open: true } }),
    audit: async () => ({ ok: true, data: { entries: [], next_cursor: null } }),
  };
}

/** Misty administers the pool while Dawn is on the clock (the pick-for case). */
function adminDto(overrides: Partial<DraftSnapshotDTO> = {}): DraftSnapshotDTO {
  const base = snapshot();
  return snapshot({
    viewer: { ...base.viewer, player_id: MISTY, is_pool_admin: true, pick_block: { code: 'NOT_YOUR_TURN' } },
    ...overrides,
  });
}

function props(dto: DraftSnapshotDTO, extra: Partial<RoomAdminSheetProps> = {}): RoomAdminSheetProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    poolId: dto.pool.id,
    seasonId: 'season-1',
    catalog: CATALOG,
    snap: {
      vm: toDraftViewModel(dto),
      dto,
      serverOffsetMs: 0,
      stale: false,
      refresh: vi.fn(async () => {}),
      applySnapshot: vi.fn(),
    },
    links: { control: '/admin/leagues/season-1/draft', audit: '/admin/leagues/season-1/draft/audit' },
    onPickForActive: vi.fn(),
    actions: fakeActions(),
    ...extra,
  };
}

function render(p: RoomAdminSheetProps, locale: 'en' | 'de' = 'en'): string {
  return renderWithI18n(<RoomAdminSheet {...p} />, { locale });
}

function tabLabels(html: string): string[] {
  return [...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((m) => m[1]);
}

beforeEach(() => {
  captured.contents = [];
  polls.calls = 0;
});

describe('RoomAdminSheet: tabs', () => {
  it('a live initial draft: Live, Picks, Settings (no Redraft, no Penalties) plus the audit and control links', () => {
    const html = render(props(adminDto()));
    expect(tabLabels(html)).toEqual(['Live', 'Picks', 'Settings']);
    expect(html).toContain('Admin controls');
    expect(html).toContain('href="/admin/leagues/season-1/draft/audit?pool=pool-1"');
    expect(html).toContain('href="/admin/leagues/season-1/draft?pool=pool-1"');
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/role="tab" aria-selected="true" aria-controls="[^"]+" tabindex="0"/);
  });

  it('a slow Redraft adds Redraft and Penalties (German labels)', () => {
    const base = adminDto();
    const dto = adminDto({ pool: { ...base.pool, kind: 'redraft', mode: 'slow' } });
    expect(tabLabels(render(props(dto), 'de'))).toEqual(['Live', 'Picks', 'Einstellungen', 'Redraft', 'Strafen']);
    expect(poolAdminSections(toDraftViewModel(dto))).toEqual(['live', 'picks', 'settings', 'redraft', 'penalties']);
  });

  it('only the open tab is mounted (the other sections, and their reads, wait for their tab)', () => {
    const actions = fakeActions();
    const html = render(props(adminDto(), { actions }));
    expect(html).toContain('The draft is running.');
    expect(html).not.toContain('Void');
    const picks = render(props(adminDto(), { initialTab: 'picks', actions }));
    expect(picks).toContain('Void');
    expect(picks).not.toContain('The draft is running.');
    // The Redraft submissions read is an effect of the Redraft tab only: nothing ran during render.
    expect(actions.calls).toEqual([]);
  });

  it('only the selected tab points at the (only) mounted panel with aria-controls', () => {
    const base = adminDto();
    const dto = adminDto({ pool: { ...base.pool, kind: 'redraft', mode: 'slow' } });
    for (const initialTab of ['live', 'picks', 'redraft'] as const) {
      const html = render(props(dto, { initialTab }));
      const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
      expect(tabs).toHaveLength(5);
      const selected = tabs.filter((tag) => tag.includes('aria-selected="true"'));
      expect(selected, initialTab).toHaveLength(1);
      const controls = /aria-controls="([^"]+)"/.exec(selected[0])?.[1];
      expect(controls, initialTab).toBeTruthy();
      expect(html).toContain(`id="${controls}" role="tabpanel"`);
      // Every other tab has no aria-controls: its panel is not in the DOM.
      for (const tag of tabs.filter((t) => t !== selected[0])) expect(tag, initialTab).not.toContain('aria-controls');
      expect([...html.matchAll(/role="tabpanel"/g)]).toHaveLength(1);
    }
  });

  it('a paused running draft says it is paused, not running (en + de)', () => {
    const base = adminDto();
    const dto = adminDto({ pool: { ...base.pool, paused: true } });
    const en = render(props(dto));
    expect(en).toContain('The draft is paused.');
    expect(en).not.toContain('The draft is running.');
    expect(render(props(dto), 'de')).toContain('Der Draft ist pausiert.');
  });

  it('a tab the pool no longer has falls back to Live', () => {
    const html = render(props(adminDto(), { initialTab: 'penalties' }));
    expect(tabLabels(html)).not.toContain('Penalties');
    expect(html).toContain('The draft is running.');
  });

  it('hides the links it was not given', () => {
    const html = render(props(adminDto(), { links: { control: null, audit: null } }));
    expect(html).not.toContain('Audit trail');
    expect(html).not.toContain('Full draft control');
  });
});

describe('RoomAdminSheet: one poller', () => {
  it('renders from the room snapshot and never calls useDraftSnapshot', () => {
    render(props(adminDto()));
    render(props(adminDto(), { initialTab: 'picks' }));
    render(props(adminDto(), { initialTab: 'settings' }));
    expect(polls.calls).toBe(0);
  });

  it('the shared sections do not import the poll hook', () => {
    for (const file of ['RoomAdminSheet.tsx', 'pool-admin.tsx']) {
      const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(src, file).not.toMatch(/from '[^']*use-draft-snapshot'/);
    }
  });

  it('a write refreshes the room snapshot; a rule error applies the snapshot it carries', async () => {
    const refresh = vi.fn(async () => {});
    const apply = vi.fn();
    expect(await settle(Promise.resolve({ ok: true as const, data: 1 }), refresh, apply)).toEqual({ error: null, data: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
    const carried = adminDto({ state_version: 99 });
    const res = await settle(
      Promise.resolve({ ok: false as const, error: { code: 'POOL_PAUSED' }, snapshot: carried }),
      refresh,
      apply,
    );
    expect(res.error).toEqual({ code: 'POOL_PAUSED' });
    expect(apply).toHaveBeenCalledWith(carried);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('RoomAdminSheet: the room keeps the pick', () => {
  it('"Pick for the active player" is a button (the room override), not a link to the room', () => {
    const html = render(props(adminDto()));
    expect(html).toMatch(/<button[^>]*>Pick for the active player<\/button>/);
    expect(html).not.toMatch(/<a[^>]*>Pick for the active player<\/a>/);
    expect(html).toContain('Switches on the admin override under the DRAFT button.');
  });

  it('no pick-for while the admin is on the clock themself', () => {
    const base = snapshot();
    const dto = snapshot({ viewer: { ...base.viewer, player_id: DAWN, is_pool_admin: true } });
    expect(render(props(dto))).not.toContain('Pick for the active player');
  });

  it('the room clock is not repeated in the sheet; "Draft paused" shows in its header for phones', () => {
    const base = adminDto();
    const dto = adminDto({ pool: { ...base.pool, paused: true, paused_at: base.server_now, pause_reason: 'admin' } });
    const html = render(props(dto));
    expect(html).not.toContain('aria-label="Draft clock"');
    expect(html).toContain('Draft paused');
  });

  it('destructive actions are amber in the room, never the red danger button', () => {
    const html = render(props(adminDto()));
    expect(html).toContain('Abort draft');
    expect(html).not.toContain('bg-poke-danger');
    expect(html).toContain('--draft-warn-ink');
  });

  it('abort is offered while drafting only: before the start the live tab shows a hint, not a button that can only fail', () => {
    const base = adminDto();
    expect(base.pool.phase).toBe('drafting');
    expect(render(props(base))).toContain('Abort draft');

    const setup = adminDto({ pool: { ...base.pool, status: 'pending', phase: 'setup' } });
    const html = render(props(setup));
    expect(html).toContain('Start draft');
    expect(html).toContain('Nothing to abort yet: the draft has not started.');
    expect(html).not.toContain('Abort draft');

    const german = render(props(setup), 'de');
    expect(german).toContain('Es gibt noch nichts abzubrechen');
    expect(german).not.toContain('Draft abbrechen');
  });

  it('main actions (Start draft, Save settings) use the neutral draft ink in the room, never the theme accent', () => {
    const base = adminDto();
    const setup = adminDto({ pool: { ...base.pool, status: 'pending', phase: 'setup' } });
    const live = render(props(setup));
    expect(live).toContain('Start draft');
    const settings = render(props(setup, { initialTab: 'settings' }));
    expect(settings).toContain('Save settings');
    for (const html of [live, settings]) {
      expect(html).not.toContain('bg-poke-accent');
      expect(html).toContain('--draft-ink,var(--poke-text-primary)');
    }
  });

  it('phone touch targets cover text inputs and checkbox labels, not only buttons and selects', () => {
    const base = adminDto();
    const setup = adminDto({ pool: { ...base.pool, status: 'pending', phase: 'setup' } });
    const html = render(props(setup, { initialTab: 'settings' }));
    expect(html).toContain('[&amp;_input:not([type=checkbox]):not([type=radio])]:min-h-[44px]');
    expect(html).toContain('[&amp;_label:has(input[type=checkbox])]:min-h-[44px]');
  });
});

describe('RoomAdminSheet: nested dialogs', () => {
  it('the armed confirms render inside the sheet content, so Radix stacks them over it', () => {
    const html = render(props(adminDto()));
    const sheetStart = html.indexOf('role="dialog"');
    const nested = html.indexOf('data-dialog="closed"', sheetStart);
    expect(sheetStart).toBeGreaterThan(-1);
    expect(nested).toBeGreaterThan(sheetStart);
    // The sheet's content is captured first, the nested confirm's after it.
    expect(captured.contents.length).toBeGreaterThan(1);
  });

  it('the sheet leaves Escape to Radix (top layer only) and hands its close focus to the room', () => {
    const onCloseAutoFocus = vi.fn();
    render(props(adminDto(), { onCloseAutoFocus }));
    const sheet = captured.contents[0];
    expect(sheet.onCloseAutoFocus).toBe(onCloseAutoFocus);
    expect(sheet.onEscapeKeyDown).toBeUndefined();
    expect(sheet.onPointerDownOutside).toBeUndefined();
    // The nested armed confirm keeps its own guards: focus on Cancel at open, no dismiss while busy.
    const nested = captured.contents[1];
    expect(typeof nested.onOpenAutoFocus).toBe('function');
    expect(typeof nested.onEscapeKeyDown).toBe('function');
  });
});

describe('RoomAdminSheet Create Redraft (league groups)', () => {
  const completeInitial = () => {
    const base = snapshot();
    return adminDto({ pool: { ...base.pool, kind: 'initial', phase: 'complete', status: 'complete' } });
  };

  it('names the shown pool\'s group on Create Redraft (en + de)', () => {
    const p = props(completeInitial(), { seasonGroupId: 'g-a', seasonGroupName: 'Group A' });
    expect(render(p)).toContain('Create Redraft for Group A');
    expect(render(p, 'de')).toContain('Redraft für Group A anlegen');
  });

  it('a league without groups: the plain Create Redraft', () => {
    const html = render(props(completeInitial()));
    expect(html).toContain('>Create Redraft<');
    expect(html).not.toContain('Create Redraft for');
  });
});

describe('RoomAdminSheet Redraft tab: the refused automatic publish', () => {
  const redraftVm = (phase: 'submissions' | 'locked' | 'drafting' | 'complete', version = 7) => {
    const base = adminDto();
    return toDraftViewModel(
      adminDto({
        state_version: version,
        pool: { ...base.pool, kind: 'redraft', phase: phase === 'locked' ? 'submissions' : phase },
        redraft: { phase, deadline_at: base.server_now, published_at: null, drops: null, viewer_slots: [] },
      }),
    );
  };

  it('reads submissions + refusal only before the reveal; re-reads on a timer only while locked', () => {
    expect(redraftSubmissionsRead(redraftVm('submissions'))).toEqual({ enabled: true, watch: false, key: '7:submissions' });
    expect(redraftSubmissionsRead(redraftVm('locked'))).toEqual({ enabled: true, watch: true, key: '7:locked' });
    // A state version or phase change restarts the read (a new key).
    expect(redraftSubmissionsRead(redraftVm('locked', 8)).key).not.toBe(redraftSubmissionsRead(redraftVm('locked')).key);
    for (const phase of ['drafting', 'complete'] as const) {
      expect(redraftSubmissionsRead(redraftVm(phase)), phase).toMatchObject({ enabled: false, watch: false });
    }
    // An initial pool never reads them.
    expect(redraftSubmissionsRead(toDraftViewModel(adminDto())).enabled).toBe(false);
    expect(REFUSAL_WATCH_MS).toBe(60_000);
  });

  it('shows the live read once it answered, the server render value before (room: nothing before)', () => {
    const server = '2026-10-18T20:00:00Z';
    const live = '2026-10-18T21:00:00Z';
    expect(shownPublishRefusal(undefined, server)).toBe(server);
    expect(shownPublishRefusal(live, server)).toBe(live);
    // The read is the fresher value, also when it says "never refused".
    expect(shownPublishRefusal(null, server)).toBeNull();
    // The room passes no server value: nothing until the Redraft tab's read answers.
    expect(shownPublishRefusal(undefined, undefined)).toBeNull();
    expect(shownPublishRefusal(live, undefined)).toBe(live);
  });

  it('accepts the admin submissions response only with publish_refused_at (an instant or null)', () => {
    const sub = { player_id: 'p1', player_name: 'Dawn', line_ids: [], updated_at: '2026-10-18T20:00:00Z' };
    expect(isAdminRedraftSubmissions({ submissions: [sub], publish_refused_at: null })).toBe(true);
    expect(isAdminRedraftSubmissions({ submissions: [], publish_refused_at: '2026-10-18T22:00:05Z' })).toBe(true);
    // The old array body, a missing field or a wrong type is not a success.
    expect(isAdminRedraftSubmissions([sub])).toBe(false);
    expect(isAdminRedraftSubmissions({ submissions: [sub] })).toBe(false);
    expect(isAdminRedraftSubmissions({ submissions: [sub], publish_refused_at: 5 })).toBe(false);
  });

  it('the Redraft tab mounts the section (the refusal read runs as its effect, never during render)', () => {
    const actions = fakeActions();
    const base = adminDto();
    const dto = adminDto({
      pool: { ...base.pool, kind: 'redraft', phase: 'submissions' },
      redraft: { phase: 'locked', deadline_at: base.server_now, published_at: null, drops: null, viewer_slots: [] },
    });
    const html = render(props(dto, { initialTab: 'redraft', actions }));
    expect(html).toContain('Submissions');
    // Not read yet in a static render: no refusal notice, no read during render.
    expect(html).not.toContain('data-publish-refused');
    expect(actions.calls).toEqual([]);
  });
});
