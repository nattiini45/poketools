/**
 * DF5 redraft UI scenarios (draft-frontend §6.1, §11.3): submission, locked,
 * reveal and picking, rendered with `renderToStaticMarkup` in EN and DE.
 * No network: the sources are in-memory stubs.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { formatPack } from '@/lib/format-pack';
import { buildFixtureCatalog } from '@/lib/draft-finder/__tests__/fixture-index';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { DAWN, MISTY, participant, snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import type { DraftSnapshotDTO, DraftSnapshotRedraft, RedraftSubmissionDTO } from '@/types/draft-queue';
import type { DraftDataSource } from '@/components/draft-tool/data-source';
import type { DraftSearchIndex } from '@/lib/draft-finder/index-types';
import RedraftSubmissionPanel from '../RedraftSubmissionPanel';
import RedraftReveal from '../RedraftReveal';
import RedraftPhaseNotice from '../RedraftPhaseNotice';
import RedraftCenter from '../RedraftCenter';
import type { RedraftSource } from '../redraft-source';

const catalog = buildFixtureCatalog();
const DEADLINE = '2026-10-12T21:59:00.000Z';

function redraftDto(redraft: DraftSnapshotRedraft, overrides: Partial<DraftSnapshotDTO> = {}): DraftSnapshotDTO {
  const base = snapshot();
  return snapshot({
    pool: { ...base.pool, id: 'redraft-1', kind: 'redraft', phase: redraft.phase === 'locked' ? 'submissions' : redraft.phase === 'complete' ? 'complete' : redraft.phase, status: redraft.phase === 'complete' ? 'complete' : redraft.phase === 'drafting' ? 'in_progress' : 'pending' },
    participants: [
      participant(DAWN, 'Dawn', 1, { standing_rank: 2, budget_remaining: 64 }),
      participant(MISTY, 'Misty', 2, { standing_rank: 1, budget_remaining: 40 }),
    ],
    active_slot: null,
    upcoming: [],
    picks: [],
    redraft,
    ...overrides,
  });
}

const SUBMISSIONS: DraftSnapshotRedraft = { phase: 'submissions', deadline_at: DEADLINE, published_at: null, drops: null, viewer_slots: [] };

function submission(overrides: Partial<RedraftSubmissionDTO> = {}): RedraftSubmissionDTO {
  return {
    line_ids: ['gastly--gengar'],
    updated_at: '2026-10-09T11:00:00.000Z',
    locked: false,
    deadline_at: DEADLINE,
    max: 2,
    own_lines: [
      { line_id: 'teddiursa--ursalunabloodmoon', real_kills: 3, price: 30, droppable: true },
      { line_id: 'gastly--gengar', real_kills: 1, price: 29, droppable: true },
      { line_id: 'cosmog--solgaleo', real_kills: 2, price: 27, droppable: false },
    ],
    leftover_budget: 6,
    ...overrides,
  };
}

const source: RedraftSource = {
  getSubmission: vi.fn(async () => ({ ok: true as const, data: submission() })),
  putSubmission: vi.fn(async () => ({ ok: true as const, data: submission() })),
};

const noSnapshotSource: DraftDataSource = {
  fetchSnapshot: async () => ({ kind: 'error', error: { code: 'network_error' } }),
  fetchMyTurn: async () => ({ kind: 'error' }),
  fetchIndex: async () => ({}) as DraftSearchIndex,
  getFavorites: async () => [],
  setFavorite: async () => ({ ok: true, data: [] }),
  postPick: async () => ({ ok: false, error: { code: 'unknown_error' } }),
  postExtension: async () => ({ ok: false, error: { code: 'unknown_error' } }),
};

function panel(dto: DraftSnapshotDTO, sub: RedraftSubmissionDTO, locale: 'en' | 'de' = 'en'): string {
  const vm = toDraftViewModel(dto, catalog);
  return renderWithI18n(<RedraftSubmissionPanel vm={vm} catalog={catalog} submission={sub} source={source} />, { locale });
}

describe('RedraftSubmissionPanel: submission open', () => {
  it('shows counter, refunds, transferring KOs, the budget preview and the secret note (EN)', () => {
    const html = panel(redraftDto(SUBMISSIONS), submission());
    expect(html).toContain('1/2 lines to drop');
    expect(html).toContain('Gastly → Gengar');
    expect(html).toContain('+29 P back');
    expect(html).toContain('3 KOs transfer');
    expect(html).toContain('1 KO transfers');
    // leftover 6 + refund 29 (only the chosen Gengar line)
    expect(html).toContain('Redraft budget: 35 P (leftover 6 + refunds 29)');
    expect(html).toContain(formatPack.messages.en.draftRedraft.tokenNote);
    expect(html).toContain('Only you and the admins can see this until the deadline.');
    expect(html).toContain('Saved');
    expect(html).toContain(`dateTime="${DEADLINE}"`);
    expect(html).toContain('>Save<');
    expect(html).toContain('Withdraw all');
    expect(html).not.toContain('The deadline has passed');
  });

  it('locks the participation line with its own text and keeps it unchecked', () => {
    const html = panel(redraftDto(SUBMISSIONS), submission());
    expect(html).toContain('Cosmog/Cosmoem cannot be redrafted.');
    const cosmogRow = html.slice(html.indexOf('Cosmog → Solgaleo') - 400, html.indexOf('Cosmog → Solgaleo'));
    expect(cosmogRow).toMatch(/<input type="checkbox" disabled=""/);
  });

  it('enforces the hard cap: unchosen rows are disabled at max', () => {
    const html = panel(
      redraftDto(SUBMISSIONS),
      submission({ max: 1, line_ids: ['gastly--gengar'] }),
    );
    expect(html).toContain('1/1 lines to drop');
    expect(html).toContain('You have chosen the maximum of 1 lines.');
    const tedRow = html.slice(html.indexOf('Teddiursa → Ursaluna') - 400, html.indexOf('Teddiursa → Ursaluna'));
    expect(tedRow).toMatch(/disabled=""/);
  });

  it('renders in German with du-form, „…“-free wording and German line names', () => {
    const html = panel(redraftDto(SUBMISSIONS), submission(), 'de');
    expect(html).toContain('1/2 Linien abgeben');
    expect(html).toContain('Nebulak → Gengar');
    expect(html).toContain('Redraft-Budget: 35 P (Rest 6 + Erstattung 29)');
    expect(html).toContain('Bis zur Frist sehen das nur du und die Admins.');
    expect(html).toContain(formatPack.messages.de.draftRedraft.tokenNote);
    expect(html).toContain('Cosmog/Cosmovum kann nicht geredraftet werden.');
    expect(html).toContain('Alle zurückziehen');
    expect(html).toContain('Frist');
  });

  it('an empty submission says the whole roster is kept', () => {
    const html = panel(redraftDto(SUBMISSIONS), submission({ line_ids: [], updated_at: null }));
    expect(html).toContain('0/2 lines to drop');
    expect(html).toContain('No lines chosen – you keep your whole roster.');
    expect(html).toContain('Redraft budget: 6 P (leftover 6 + refunds 0)');
  });
});

describe('RedraftSubmissionPanel: locked', () => {
  it('is read-only after the deadline (server lock)', () => {
    const html = panel(redraftDto({ ...SUBMISSIONS, phase: 'locked' }), submission({ locked: true }));
    expect(html).toContain('The deadline has passed – your drops can no longer be changed.');
    expect(html).not.toContain('>Save<');
    expect(html).not.toContain('Withdraw all');
    expect(html).toMatch(/<fieldset disabled=""/);
  });

  it('is read-only once the snapshot leaves the submission phase, even if the DTO is stale', () => {
    const html = panel(redraftDto({ ...SUBMISSIONS, phase: 'locked' }), submission({ locked: false }), 'de');
    expect(html).toContain('Die Frist ist abgelaufen');
    expect(html).not.toContain('Speichern<');
  });
});

const PUBLISHED: DraftSnapshotRedraft = {
  phase: 'drafting',
  deadline_at: DEADLINE,
  published_at: '2026-10-13T08:00:00.000Z',
  drops: [
    { player_id: DAWN, line_id: 'gastly--gengar', transferred_real_kills: 1 },
    { player_id: MISTY, line_id: 'teddiursa--ursaluna', transferred_real_kills: 0 },
  ],
  viewer_slots: [
    { redraft_slot_id: 'rs-a', label: 'A', dropped_line_id: 'gastly--gengar', transferred_real_kills: 1, filled_by_pick_id: null },
  ],
};

describe('RedraftReveal: drops revealed / picking', () => {
  it('groups the drops by player in redraft order, with slots, budget and the order strip', () => {
    const vm = toDraftViewModel(redraftDto(PUBLISHED, { taken: { 'teddiursa--ursaluna': DAWN } }), catalog);
    const html = renderWithI18n(<RedraftReveal vm={vm} catalog={catalog} />);
    expect(html).toContain('Redraft drops');
    expect(html.indexOf('Dawn')).toBeLessThan(html.indexOf('Misty'));
    expect(html).toContain('Rank 2 after the first half');
    expect(html).toContain('Gastly → Gengar');
    expect(html).toContain('no KOs transfer');
    expect(html).toContain('Back in the pool');
    expect(html).toContain('Drafted by Dawn');
    expect(html).toContain('Free');
    expect(html).toContain('Your redraft slots');
    expect(html).toContain('Slot A');
    expect(html).toContain('replaces Gastly → Gengar');
    expect(html).toContain('Open');
    expect(html).toContain('Redraft budget: 64 P');
    expect(html).toContain('Snake order');
  });

  it('renders in German', () => {
    const vm = toDraftViewModel(redraftDto(PUBLISHED), catalog);
    const html = renderWithI18n(<RedraftReveal vm={vm} catalog={catalog} />, { locale: 'de' });
    expect(html).toContain('Redraft-Abgaben');
    expect(html).toContain('Deine Redraft-Plätze');
    expect(html).toContain('Platz A');
    expect(html).toContain('ersetzt Nebulak → Gengar');
    expect(html).toContain('Wieder im Pool');
    expect(html).toContain('Snake-Reihenfolge');
  });

  it('a spectator sees the drops but no slots or budget', () => {
    const vm = toDraftViewModel(
      redraftDto({ ...PUBLISHED, viewer_slots: [] }, {
        viewer: { ...snapshot().viewer, player_id: null, is_participant: false },
      }),
      catalog,
    );
    const html = renderWithI18n(<RedraftReveal vm={vm} catalog={catalog} />);
    expect(html).toContain('Gastly → Gengar');
    expect(html).not.toContain('Your redraft slots');
    expect(html).not.toContain('Redraft budget');
  });
});

describe('RedraftCenter: phase switch', () => {
  const links = { room: '/leagues/s/draft-room?pool=redraft-1' };
  const render = (dto: DraftSnapshotDTO | null, playerId: string | null = DAWN, locale: 'en' | 'de' = 'en') =>
    renderWithI18n(
      <RedraftCenter
        seasonId="season-1"
        poolId="redraft-1"
        catalog={catalog}
        initialSnapshot={dto}
        viewer={{ playerId }}
        links={links}
        dataSource={noSnapshotSource}
        redraftSource={source}
      />,
      { locale },
    );

  it('a participant in the submission phase gets the panel loader (the submission is fetched on the client)', () => {
    const html = render(redraftDto(SUBMISSIONS));
    expect(html).toContain('Loading the redraft');
    expect(html).not.toContain('gastly--gengar');
    expect(source.getSubmission).not.toHaveBeenCalled();
  });

  it('a spectator in the submission phase only learns that drops are secret', () => {
    const dto = redraftDto(SUBMISSIONS, { viewer: { ...snapshot().viewer, player_id: null, is_participant: false } });
    expect(render(dto, null)).toContain('Every player picks their drops in secret.');
    expect(render(dto, null, 'de')).toContain('Alle wählen ihre Abgaben verdeckt.');
  });

  it('locked: spectators see that publication is pending', () => {
    const dto = redraftDto({ ...SUBMISSIONS, phase: 'locked' }, { viewer: { ...snapshot().viewer, player_id: null, is_participant: false } });
    expect(render(dto, null)).toContain('Submissions are closed.');
  });

  it('picking: the reveal plus the draft-room link', () => {
    const html = render(redraftDto(PUBLISHED));
    expect(html).toContain('Go to the draft room');
    expect(html).toContain('Redraft drops');
    expect(render(redraftDto(PUBLISHED), DAWN, 'de')).toContain('Zum Draft-Raum');
  });

  it('complete: the reveal without the room link', () => {
    const html = render(redraftDto({ ...PUBLISHED, phase: 'complete' }));
    expect(html).toContain('The redraft is complete.');
    expect(html).not.toContain('Go to the draft room');
  });

  it('no redraft block yet: not open; no snapshot: loading', () => {
    expect(render(redraftDto(SUBMISSIONS, { redraft: null }))).toContain('The redraft has not opened yet.');
    expect(render(null)).toContain('Loading the redraft');
  });
});

describe('RedraftPhaseNotice', () => {
  it('submission phase: text, deadline and the redraft link (EN/DE)', () => {
    const el = <RedraftPhaseNotice phase="submissions" deadlineAt={DEADLINE} links={{ redraft: '/leagues/s/redraft' }} />;
    const en = renderWithI18n(el);
    expect(en).toContain('Redraft submission phase');
    expect(en).toContain(`dateTime="${DEADLINE}"`);
    expect(en).toContain('href="/leagues/s/redraft"');
    expect(en).toContain('Go to the redraft');
    const de = renderWithI18n(el, { locale: 'de' });
    expect(de).toContain('Abgabephase des Redrafts');
    expect(de).toContain('Zum Redraft');
  });

  it('locked: closed text; other phases render nothing', () => {
    expect(renderWithI18n(<RedraftPhaseNotice phase="locked" deadlineAt={DEADLINE} links={{ redraft: '/r' }} />)).toContain(
      'Redraft submissions are closed.',
    );
    expect(renderWithI18n(<RedraftPhaseNotice phase="drafting" deadlineAt={null} links={{ redraft: '/r' }} />)).toBe('');
  });
});
