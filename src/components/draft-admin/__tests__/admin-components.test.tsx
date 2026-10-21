import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator, getMessages } from '@/i18n/core';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { DAWN, MISTY, snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { DRAFT_AUDIT_ACTIONS, type AuditEntryDTO, type DraftSnapshotDTO, type LineId } from '@/types/draft-queue';
import PickCorrectionTable from '../PickCorrectionTable';
import PenaltyStageEditor from '../PenaltyStageEditor';
import RedraftPhaseManager from '../RedraftPhaseManager';
import DraftAuditViewer, { AuditRow } from '../DraftAuditViewer';
import InstanceConfigForm from '../InstanceConfigForm';
import TokenAdminSummary, { loadTokenRows } from '../TokenAdminSummary';
import DraftControlPanel, { initialTab } from '../DraftControlPanel';
import type { AdminDraftActions } from '../admin-actions';
import type { DraftDataSource } from '@/components/draft-tool/data-source';
import type { TokenSource } from '@/components/draft-tokens/token-source';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/admin' }));

function entry(lineId: LineId, names: string[], price: number): DraftLineCatalogEntry {
  return {
    lineId,
    entryId: `e-${lineId}`,
    lineNumber: 1,
    price,
    stages: names.map((name, i) => ({ stage: (i + 1) as 1 | 2 | 3, name, speciesId: name.toLowerCase() })),
    thresholds: { toStage2: 3, additionalToStage3: 4, cumulative: [3, 7] },
    flags: { cosmog: false, noRedraft: false, scatterbugCocoon: false },
    specialRules: null,
    branch: { groupKey: names[0].toLowerCase(), count: 1 },
  };
}

const CATALOG: DraftLineCatalog = {
  listVersionId: 'list-1',
  bannedMoves: [],
  lines: [
    entry('gastly--gengar', ['Gastly', 'Haunter', 'Gengar'], 28),
    entry('teddiursa--ursalunabloodmoon', ['Teddiursa', 'Ursaring', 'Ursaluna-Bloodmoon'], 30),
    entry('abra--alakazam', ['Abra', 'Kadabra', 'Alakazam'], 25),
  ],
};

const noop = vi.fn(async () => null);

function vmOf(overrides: Partial<DraftSnapshotDTO> = {}) {
  return toDraftViewModel(snapshot(overrides));
}

/** The `<button …>Label</button>` element for a label (static markup). */
function buttonTag(html: string, label: string): string {
  const re = new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`, 'g');
  const found = html.match(re);
  expect(found, `button "${label}"`).not.toBeNull();
  return (found as RegExpMatchArray)[0];
}

describe('PickCorrectionTable', () => {
  it('disables void and correct while the draft runs unpaused, with the pause hint', () => {
    const html = renderWithI18n(
      <PickCorrectionTable vm={vmOf()} catalog={CATALOG} onVoid={noop} onCorrect={noop} onPause={noop} />,
    );
    expect(html).toContain('Pause the draft to void or correct picks.');
    expect(html).toContain('Pause now');
    expect(buttonTag(html, 'Void')).toMatch(/ disabled=""/);
    expect(buttonTag(html, 'Correct line')).toMatch(/ disabled=""/);
  });

  it('enables them when paused (German)', () => {
    const paused = vmOf({ pool: { ...snapshot().pool, paused: true, pause_reason: 'admin' } });
    const html = renderWithI18n(
      <PickCorrectionTable vm={paused} catalog={CATALOG} onVoid={noop} onCorrect={noop} onPause={noop} />,
      { locale: 'de' },
    );
    expect(html).not.toContain('Pausiere den Draft');
    expect(buttonTag(html, 'Annullieren')).not.toMatch(/disabled=""/);
    expect(buttonTag(html, 'Linie korrigieren')).not.toMatch(/disabled=""/);
    expect(html).toContain('Gengar');
  });

  it('offers no forfeit: the void dialog has no requeue choice (en + de)', () => {
    const paused = vmOf({ pool: { ...snapshot().pool, paused: true, pause_reason: 'admin' } });
    for (const locale of ['en', 'de'] as const) {
      const html = renderWithI18n(
        <PickCorrectionTable vm={paused} catalog={CATALOG} onVoid={noop} onCorrect={noop} onPause={noop} />,
        { locale },
      );
      expect(html).not.toMatch(/type="checkbox"/);
      expect(html).not.toMatch(/forfeit|verfallen/i);
    }
  });
});

describe('admin draft strings (no blocked slot, no forfeit)', () => {
  const en = createTranslator(draftAdminMessages, 'en');
  const de = createTranslator(draftAdminMessages, 'de');
  it('end is an abort that voids picks, never a forfeit', () => {
    expect(en('live.end')).toBe('Abort draft');
    expect(en('live.endBody')).toContain('Every pick is voided');
    expect(de('live.endBody')).toContain('Alle Picks werden annulliert');
    expect(en('live.endBody')).not.toMatch(/stay empty|forfeit/i);
    expect(de('live.endBody')).not.toMatch(/bleiben leer|verfallen/i);
  });
  it('the blocked-pick strings are gone in both languages', () => {
    for (const locale of ['en', 'de'] as const) {
      const messages = getMessages(draftAdminMessages, locale) as unknown as Record<string, unknown>;
      expect(messages).not.toHaveProperty('blocked');
      expect((messages.panel as Record<string, Record<string, unknown>>).sections).not.toHaveProperty('blocked');
    }
  });
});

describe('PenaltyStageEditor', () => {
  it('offers exactly one option per ladder stage', () => {
    const slow = vmOf({
      pool: { ...snapshot().pool, mode: 'slow' },
      config: { ...snapshot().config, slow_ladder_seconds: [43_200, 21_600, 10_800] },
    });
    const html = renderWithI18n(<PenaltyStageEditor vm={slow} onSet={noop} />);
    // Two participants × three stages.
    expect(html.match(/<option /g)).toHaveLength(6);
    expect(html).toContain('Stage 3 – 3h');
    expect(html).not.toContain('Stage 4');
    expect(buttonTag(html, 'Set stage')).toMatch(/ disabled=""/);
  });
});

describe('RedraftPhaseManager', () => {
  const redraftDto = (deadline: string): Partial<DraftSnapshotDTO> => ({
    pool: { ...snapshot().pool, kind: 'redraft', phase: 'submissions', status: 'pending' },
    redraft: { phase: 'submissions', deadline_at: deadline, published_at: null, drops: null, viewer_slots: [] },
  });

  it('disables publish before the deadline without force', () => {
    const vm = vmOf(redraftDto('2099-01-01T00:00:00.000Z'));
    const html = renderWithI18n(
      <RedraftPhaseManager
        vm={vm}
        catalog={CATALOG}
        submissions={[{ player_id: DAWN, player_name: 'Dawn', line_ids: ['gastly--gengar'], updated_at: '2026-10-09T10:00:00Z' }]}
        submissionsError={null}
        slots={null}
        deadlineFieldId="deadline"
        nowMs={Date.parse('2026-10-09T12:00:00Z')}
        onPatchDeadline={noop}
        onPublish={async () => ({ error: null, drops: 0 })}
        onRestore={noop}
      />,
    );
    expect(buttonTag(html, 'Publish drops')).toMatch(/ disabled=""/);
    expect(html).toContain('Before the deadline you can only publish');
    expect(html).toContain('Force publish before the deadline');
    // Admins see the submission contents; Misty has not submitted.
    expect(html).toContain('Gengar');
    expect(html).toContain('Nothing submitted');
  });

  it('enables publish once the deadline has passed', () => {
    const vm = vmOf(redraftDto('2026-10-01T00:00:00.000Z'));
    const html = renderWithI18n(
      <RedraftPhaseManager
        vm={vm}
        catalog={CATALOG}
        submissions={[]}
        submissionsError={null}
        slots={null}
        deadlineFieldId="deadline"
        nowMs={Date.parse('2026-10-09T12:00:00Z')}
        onPatchDeadline={noop}
        onPublish={async () => ({ error: null, drops: 0 })}
        onRestore={noop}
      />,
    );
    expect(buttonTag(html, 'Publish drops')).not.toMatch(/disabled=""/);
  });

  it('renders the deadline field empty on the server (the client fills its local zone)', () => {
    const html = renderWithI18n(
      <RedraftPhaseManager
        vm={vmOf(redraftDto('2099-01-01T00:00:00.000Z'))}
        catalog={CATALOG}
        submissions={[]}
        submissionsError={null}
        slots={null}
        deadlineFieldId="deadline"
        nowMs={0}
        onPatchDeadline={noop}
        onPublish={async () => ({ error: null, drops: 0 })}
        onRestore={noop}
      />,
    );
    const input = html.match(/<input[^>]*id="deadline"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('type="datetime-local"');
    expect(input).toContain('value=""');
  });

  it('offers Restore drop only for a known open redraft slot', () => {
    const published: Partial<DraftSnapshotDTO> = {
      pool: { ...snapshot().pool, kind: 'redraft', phase: 'drafting' },
      redraft: {
        phase: 'drafting',
        deadline_at: '2026-10-01T00:00:00.000Z',
        published_at: '2026-10-01T00:00:00.000Z',
        drops: [{ player_id: MISTY, line_id: 'abra--alakazam', transferred_real_kills: 2 }],
        viewer_slots: [],
      },
    };
    const props = {
      vm: vmOf(published),
      catalog: CATALOG,
      submissions: null,
      submissionsError: null,
      deadlineFieldId: 'deadline',
      nowMs: 0,
      onPatchDeadline: noop,
      onPublish: async () => ({ error: null, drops: 0 }),
      onRestore: noop,
    };
    const without = renderWithI18n(<RedraftPhaseManager {...props} slots={null} />);
    expect(without).toContain('Alakazam');
    expect(without).not.toContain('Restore drop');
    const withSlots = renderWithI18n(
      <RedraftPhaseManager
        {...props}
        slots={[{ redraftSlotId: 'rs1', playerId: MISTY, lineId: 'abra--alakazam', label: 'A', filledByPickId: null }]}
      />,
    );
    expect(withSlots).toContain('Restore drop');
  });
});

describe('InstanceConfigForm', () => {
  it('is editable in setup and locked after the start', () => {
    const setupDto = snapshot({ pool: { ...snapshot().pool, phase: 'setup', status: 'pending' } });
    const setup = renderWithI18n(
      <InstanceConfigForm vm={toDraftViewModel(setupDto)} dto={setupDto} onSaveConfig={noop} onPatchRedraft={noop} />,
    );
    expect(setup).toContain('Save settings');
    expect(setup).toContain('Seat 1');
    expect(setup).toContain('Move Dawn down');

    const runningDto = snapshot();
    const running = renderWithI18n(
      <InstanceConfigForm vm={toDraftViewModel(runningDto)} dto={runningDto} onSaveConfig={noop} onPatchRedraft={noop} />,
    );
    expect(running).toContain('The settings are locked once the draft has started.');
    expect(running).not.toContain('Save settings');
    expect(running).toMatch(/<fieldset disabled=""/);
  });
});

describe('Audit trail viewer', () => {
  const base: AuditEntryDTO = {
    id: '7',
    occurred_at: '2026-10-09T12:00:00.000Z',
    actor: { player_id: null, name: 'System', role: 'system' },
    action: 'timeout',
    player_name: 'Dawn',
    line_id: null,
    slot_label: null,
    pick_number: 3,
    before: { penalty_stage: 0 },
    after: { penalty_stage: 1 },
    note: null,
    is_public: true,
  };

  it('has a label for every DraftAuditAction in English and German', () => {
    for (const locale of ['en', 'de'] as const) {
      const messages = getMessages(draftAdminMessages, locale) as { audit: { action: Record<string, string> } };
      for (const action of DRAFT_AUDIT_ACTIONS) {
        expect(messages.audit.action[action], `${locale}: ${action}`).toBeTruthy();
      }
    }
  });

  it('renders a row: role badge, translated action, change pair', () => {
    const html = renderWithI18n(
      <table>
        <tbody>
          <AuditRow entry={base} lineLabel={(id) => id} />
        </tbody>
      </table>,
      { locale: 'de' },
    );
    expect(html).toContain('Zeitüberschreitung');
    expect(html).toContain('System');
    expect(html).toContain('penalty_stage: 0 → 1');
    expect(html).toContain('Pick 3');
  });

  it('falls back to the raw action for an action added later', () => {
    const t = createTranslator(draftAdminMessages, 'en');
    expect(t.dynamic('audit.action.brand_new_action', undefined, 'brand_new_action')).toBe('brand_new_action');
  });

  it('has no delete or edit control', () => {
    const html = renderWithI18n(
      <DraftAuditViewer
        seasonId="season-1"
        pools={[{ id: 'pool-1', engine: 'queue', kind: 'initial', phase: 'drafting', mode: 'live', status: 'in_progress' }]}
        initialPoolId="pool-1"
        participants={[{ id: DAWN, name: 'Dawn' }]}
        catalog={CATALOG}
        loadPage={async () => ({ ok: true, data: { entries: [base], next_cursor: null } })}
      />,
    );
    expect(html).toContain('Read only – entries cannot be changed or deleted.');
    // The only buttons are filter controls ("Reset filters", "Load more"); none here.
    expect(html.match(/<button/g) ?? []).toHaveLength(0);

    const row = renderWithI18n(
      <table>
        <tbody>
          <AuditRow entry={base} lineLabel={(id) => id} />
        </tbody>
      </table>,
    );
    expect(row).not.toMatch(/<button|<input|delete|remove/i);
  });

  it('never calls a write route', () => {
    const source = readFileSync(resolve(__dirname, '../DraftAuditViewer.tsx'), 'utf8');
    expect(source).not.toMatch(/'(POST|PATCH|PUT|DELETE)'/);
    expect(source).not.toMatch(/createAdminDraftActions|voidPick|correctPick|restoreDrop/);
  });
});

describe('TokenAdminSummary', () => {
  const source: TokenSource = {
    overview: async () => ({ ok: false, error: { code: 'INTERNAL', message: 'x' } }) as never,
    overviewAll: async () => ({ ok: true, data: [] }),
    buyDraftKill: async () => ({ ok: false, error: { code: 'INTERNAL', message: 'x' } }) as never,
    spendComeback: async () => ({ ok: false, error: { code: 'INTERNAL', message: 'x' } }) as never,
  };
  const props = {
    seasonId: 'season-1',
    participants: [{ id: DAWN, name: 'Dawn' }],
    comebackSpendOpen: false,
    hasRedraft: false,
    source,
  };

  it('works with the spec signature: no catalog hides Details', () => {
    const html = renderWithI18n(<TokenAdminSummary {...props} />);
    expect(html).toContain('Dawn');
    expect(html).not.toContain('>Details<');
  });

  it('shows Details when a catalog is passed', () => {
    expect(renderWithI18n(<TokenAdminSummary {...props} catalog={CATALOG} />)).toContain('>Details<');
  });

  it('loads every row through one batched overviewAll call, never one overview per participant', async () => {
    const overview = vi.fn(source.overview);
    const overviewAll = vi.fn(async () => ({ ok: true as const, data: [] }));
    const rows = await loadTokenRows({ ...source, overview, overviewAll }, [DAWN, MISTY]);
    expect(overviewAll).toHaveBeenCalledTimes(1);
    expect(overview).not.toHaveBeenCalled();
    expect(rows).toEqual({ [DAWN]: { kind: 'empty' }, [MISTY]: { kind: 'empty' } });
  });
});

describe('DraftControlPanel (preview injection)', () => {
  const fail = async () => ({ ok: false as const, error: { code: 'INTERNAL' } });
  const fakeSource = (): DraftDataSource => ({
    fetchSnapshot: async () => ({ kind: 'unchanged' }) as never,
    fetchMyTurn: async () => ({ kind: 'error' }),
    fetchIndex: async () => ({}) as never,
    getFavorites: async () => [],
    setFavorite: fail as never,
    postPick: fail as never,
    postExtension: fail as never,
  });
  const fakeActions = (): AdminDraftActions => new Proxy({} as AdminDraftActions, { get: () => fail });

  const redraftPool = {
    id: 'pool-r',
    engine: 'queue' as const,
    kind: 'redraft' as const,
    phase: 'drafting' as const,
    mode: 'live' as const,
    status: 'in_progress' as const,
  };
  const published = snapshot({
    pool: { ...snapshot().pool, id: 'pool-r', kind: 'redraft', phase: 'drafting' },
    redraft: {
      phase: 'drafting',
      deadline_at: '2026-10-01T00:00:00.000Z',
      published_at: '2026-10-01T00:00:00.000Z',
      drops: [{ player_id: MISTY, line_id: 'abra--alakazam', transferred_real_kills: 2 }],
      viewer_slots: [],
      admin_slots: [
        {
          redraft_slot_id: 'rs-1',
          player_id: MISTY,
          label: 'A',
          dropped_line_id: 'abra--alakazam',
          transferred_real_kills: 2,
          filled_by_pick_id: null,
        },
      ],
    },
  });
  const panel = (dto: DraftSnapshotDTO, inject: { dataSourceFor?: () => DraftDataSource; actionsFor?: () => AdminDraftActions }) => (
    <DraftControlPanel
      seasonId="season-1"
      pools={[redraftPool]}
      catalog={CATALOG}
      initialSnapshots={{ 'pool-r': dto }}
      links={{ audit: '/audit', room: '/room' }}
      dataSourceFor={inject.dataSourceFor}
      actionsFor={inject.actionsFor}
    />
  );

  it('mounts on injected sources without any network call and offers Restore drop from admin_slots', () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const dataSourceFor = vi.fn(() => fakeSource());
    const actionsFor = vi.fn(() => fakeActions());
    try {
      const html = renderWithI18n(panel(published, { dataSourceFor, actionsFor }));
      expect(dataSourceFor).toHaveBeenCalledWith('pool-r');
      expect(actionsFor).toHaveBeenCalledWith('pool-r');
      expect(html).toContain('Restore drop');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('no Restore drop while the snapshot carries no admin_slots (pre-publish / non-admin)', () => {
    const redraft = published.redraft as NonNullable<DraftSnapshotDTO['redraft']>;
    const withoutSlots = { ...redraft, admin_slots: undefined };
    const html = renderWithI18n(
      panel({ ...published, redraft: withoutSlots }, { dataSourceFor: fakeSource, actionsFor: fakeActions }),
    );
    expect(html).toContain('Alakazam');
    expect(html).not.toContain('Restore drop');
  });

  it('has no token summary: the Tokens card links the league admin page, Draft tab (en + de)', () => {
    const html = renderWithI18n(panel(published, { dataSourceFor: fakeSource, actionsFor: fakeActions }));
    expect(html).toContain('href="/admin/leagues/season-1?tab=draft"');
    expect(html).toContain('League admin: Draft');
    expect(html).not.toContain('Allow Comeback Token spending');
    const de = renderWithI18n(panel(published, { dataSourceFor: fakeSource, actionsFor: fakeActions }), { locale: 'de' });
    expect(de).toContain('Liga-Verwaltung: Draft');
  });

  it('the pool tabs are a keyboard tablist: roving tabindex, aria-controls on the selected tab, 44 px on phones', () => {
    const html = renderWithI18n(panel(published, { dataSourceFor: fakeSource, actionsFor: fakeActions }));
    const tab = /<button[^>]*role="tab"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tab).toContain('aria-selected="true"');
    expect(tab).toContain('tabindex="0"');
    expect(tab).toMatch(/aria-controls="[^"]+-panel"/);
    expect(tab).toContain('min-h-11');
    expect(html).toMatch(/role="tabpanel" id="[^"]+-panel" aria-labelledby="[^"]+-tab-pool-r"/);
  });
});

describe('DraftControlPanel in a league with groups', () => {
  const fail = async () => ({ ok: false as const, error: { code: 'INTERNAL' } });
  const fakeSource = (): DraftDataSource => ({
    fetchSnapshot: async () => ({ kind: 'unchanged' }) as never,
    fetchMyTurn: async () => ({ kind: 'error' }),
    fetchIndex: async () => ({}) as never,
    getFavorites: async () => [],
    setFavorite: fail as never,
    postPick: fail as never,
    postExtension: fail as never,
  });
  const fakeActions = (): AdminDraftActions => new Proxy({} as AdminDraftActions, { get: () => fail });
  const groupPool = (id: string, kind: 'initial' | 'redraft', group: 'A' | 'B' | null) => ({
    id,
    engine: 'queue' as const,
    kind,
    phase: 'complete' as const,
    mode: 'live' as const,
    status: 'complete' as const,
    season_group_id: group ? `g-${group}` : null,
    season_group_name: group ? `Group ${group}` : null,
  });
  const noFetch = () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network');
    });
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  };

  it("labels the tabs by group and binds Create Redraft to the selected tab's group (en + de)", () => {
    const fetchSpy = noFetch();
    const actionsFor = vi.fn(() => fakeActions());
    try {
      const pools = [groupPool('ia', 'initial', 'A'), groupPool('ib', 'initial', 'B'), groupPool('rb', 'redraft', 'B')];
      const view = (
        <DraftControlPanel
          seasonId="season-1"
          pools={pools}
          catalog={CATALOG}
          initialSnapshots={{}}
          initialPoolId="rb"
          links={{ audit: '/audit', room: '/room' }}
          dataSourceFor={() => fakeSource()}
          actionsFor={actionsFor}
        />
      );
      const html = renderWithI18n(view);
      expect(html).toContain('Group A · Initial draft');
      expect(html).toContain('Group B · Initial draft');
      expect(html).toContain('Group B · Redraft 1');
      expect(html).toContain('Create Redraft for Group B');
      expect(html).not.toContain('Create Redraft for Group A');
      // The Redraft's actions are the selected group's Initial draft pool's.
      expect(actionsFor).toHaveBeenCalledWith('ib');
      expect(actionsFor).not.toHaveBeenCalledWith('ia');
      expect(renderWithI18n(view, { locale: 'de' })).toContain('Redraft für Group B anlegen');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a league without groups: plain tab labels and the season-wide Create Redraft', () => {
    noFetch();
    const actionsFor = vi.fn(() => fakeActions());
    try {
      const html = renderWithI18n(
        <DraftControlPanel
          seasonId="season-1"
          pools={[groupPool('i', 'initial', null), groupPool('r', 'redraft', null)]}
          catalog={CATALOG}
          initialSnapshots={{}}
          links={{ audit: '/audit', room: '/room' }}
          dataSourceFor={() => fakeSource()}
          actionsFor={actionsFor}
        />,
      );
      expect(html).toContain('>Initial draft<');
      expect(html).toContain('Redraft 1');
      expect(html).not.toContain(' · ');
      expect(html).toContain('>Create Redraft<');
      expect(actionsFor).toHaveBeenCalledWith('i');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('DraftControlPanel initial tab (?pool= from the room sheet)', () => {
  const pool = (id: string, kind: 'initial' | 'redraft', status: 'in_progress' | 'complete') => ({
    id,
    engine: 'queue' as const,
    kind,
    phase: status === 'complete' ? ('complete' as const) : ('drafting' as const),
    mode: 'live' as const,
    status,
  });
  // Initial and Redraft both complete: the room shows the Initial pool, the default tab is the newest (Redraft).
  const pools = [pool('pool-i', 'initial', 'complete'), pool('pool-r', 'redraft', 'complete')];

  it('opens the requested pool even when another pool would be the default', () => {
    expect(initialTab(pools)).toBe('pool-r');
    expect(initialTab(pools, 'pool-i')).toBe('pool-i');
  });

  it('ignores an unknown pool and prefers a running pool by default', () => {
    expect(initialTab(pools, 'pool-x')).toBe('pool-r');
    const running = [pool('pool-i', 'initial', 'in_progress'), pool('pool-r', 'redraft', 'complete')];
    expect(initialTab(running, null)).toBe('pool-i');
    expect(initialTab([], 'pool-i')).toBeNull();
  });
});
