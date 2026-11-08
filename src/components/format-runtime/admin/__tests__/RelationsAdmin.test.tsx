/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import RelationsAdmin from '../RelationsAdmin';
import { BROCK, MARA, MISTY, SEASON, actionView, failResponse, okResponse, relationView, sent, text } from './helpers';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const fetchMock = vi.fn();
const ACTIONS = [actionView()];
const ROSTER = [
  { id: MARA, name: 'Mara' },
  { id: MISTY, name: 'Misty' },
  { id: BROCK, name: 'Brock' },
  { id: 'gone', name: null },
];

const UNMASKED = {
  relations: [
    {
      ...relationView({ masked: false }),
      links: [
        { from: { id: MARA, name: 'Mara' }, to: { id: MISTY, name: 'Misty' }, revealed: false, involves_viewer: false },
        { from: { id: MISTY, name: 'Misty' }, to: { id: BROCK, name: 'Brock' }, revealed: false, involves_viewer: false },
      ],
    },
  ],
  submissions: [
    {
      action: 'gift',
      rows: [
        { player: { id: MARA, name: 'Mara' }, state: 'submitted', target: { id: MISTY, name: 'Misty' }, involves_viewer: false },
        { player: { id: BROCK, name: 'Brock' }, state: 'draft', target: null, involves_viewer: false },
      ],
    },
  ],
};

// The reading admin is Brock, who also plays: the link into him (Misty gives to Brock) and his own submission row involve
// him, and so does Mara's row, which names him as her target.
const BROCK_PLAYS = {
  relations: [
    {
      ...relationView({ masked: false }),
      links: [
        { from: { id: MARA, name: 'Mara' }, to: { id: MISTY, name: 'Misty' }, revealed: false, involves_viewer: false },
        { from: { id: MISTY, name: 'Misty' }, to: { id: BROCK, name: 'Brock' }, revealed: false, involves_viewer: true },
      ],
    },
  ],
  submissions: [
    {
      action: 'gift',
      rows: [
        { player: { id: MARA, name: 'Mara' }, state: 'submitted', target: { id: BROCK, name: 'Brock' }, involves_viewer: true },
        { player: { id: MISTY, name: 'Misty' }, state: 'locked', target: { id: MARA, name: 'Mara' }, involves_viewer: false },
        { player: { id: BROCK, name: 'Brock' }, state: 'draft', target: { id: MISTY, name: 'Misty' }, involves_viewer: true },
      ],
    },
  ],
};

function mount(props: Partial<React.ComponentProps<typeof RelationsAdmin>> = {}, locale: Locale = 'en') {
  return render(
    withI18n(<RelationsAdmin seasonId={SEASON} relations={[relationView()]} actions={ACTIONS} canReveal roster={ROSTER} {...props} />, { locale }),
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mocks.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('RelationsAdmin: masked by default', () => {
  it('shows the relation as a player sees it: a link count, no names, no states', () => {
    mount({ relations: [relationView({ links: [] })] });
    expect(screen.getByText('Secret Santa')).toBeTruthy();
    expect(screen.getByText('3 links')).toBeTruthy();
    expect(screen.getByText('No link is visible to you.')).toBeTruthy();
    expect(screen.queryByText('Submissions')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the sides the admin may see and marks the hidden one', () => {
    mount({
      relations: [relationView({ link_count: 1, links: [{ from: null, to: { id: MISTY, name: 'Misty' }, revealed: false }] })],
    });
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('hidden')).toBeTruthy();
    expect(within(row).getByText('Misty')).toBeTruthy();
  });

  it('a relation whose links are all revealed is marked public and offers no Reveal', () => {
    mount({
      relations: [
        relationView({
          link_count: 1,
          links: [{ from: { id: MARA, name: 'Mara' }, to: { id: MISTY, name: 'Misty' }, revealed: true }],
        }),
      ],
    });
    expect(screen.getByText('Public')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Reveal/ })).toBeNull();
  });

  it('a former player is named as one, never by id', () => {
    mount({
      relations: [relationView({ link_count: 1, links: [{ from: { id: MARA, name: null }, to: { id: MISTY, name: 'Misty' }, revealed: true }] })],
    });
    expect(screen.getByText('former player')).toBeTruthy();
    expect(document.body.textContent).not.toContain(MARA);
  });
});

describe('RelationsAdmin: show hidden sides', () => {
  it('asks first, says it is audited, and reads nothing until confirmed', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Show hidden sides' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/If you play in this league yourself/)).toBeTruthy();
    expect(within(dialog).getByText(/recorded in the audit log/)).toBeTruthy();
    expect(within(dialog).getByText(/players keep seeing only their own side/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('after the confirmation it calls the audited route and lists links and the state of each player', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse(UNMASKED));
    mount();
    await user.click(screen.getByRole('button', { name: 'Show hidden sides' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show' }));

    expect(await screen.findByText('Hidden sides shown')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(fetchMock)).toEqual({ url: `/api/seasons/${SEASON}/format/relations/unmask`, method: 'POST', body: {} });

    // Both data-only tables are focusable scroll regions, so a keyboard user can reach the cut-off columns.
    for (const name of ['Links of Secret Santa', 'Submissions for Gift']) {
      expect(screen.getByRole('table', { name }).closest('[role="region"]')?.getAttribute('tabindex')).toBe('0');
    }
    const linkRows = within(screen.getByRole('table', { name: 'Links of Secret Santa' })).getAllByRole('row');
    expect(linkRows).toHaveLength(3);
    expect(within(linkRows[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Mara', 'Misty']);

    const submissions = screen.getByRole('table', { name: 'Submissions for Gift' });
    const rows = within(submissions).getAllByRole('row');
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Mara', 'Submitted', 'Misty']);
    expect(within(rows[2]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Brock', 'Draft', 'none']);
  });

  it('can be hidden again, which drops what was read', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse(UNMASKED));
    mount();
    await user.click(screen.getByRole('button', { name: 'Show hidden sides' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show' }));
    await screen.findByText('Hidden sides shown');
    await user.click(screen.getByRole('button', { name: 'Hide again' }));
    expect(screen.queryByText('Hidden sides shown')).toBeNull();
    expect(screen.queryByText('Submissions')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show hidden sides' })).toBeTruthy();
  });

  it('a refused read shows its words and reveals nothing', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(403, 'forbidden', 'Forbidden'));
    mount();
    await user.click(screen.getByRole('button', { name: 'Show hidden sides' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Hidden sides shown')).toBeNull();
  });
});

async function unmaskWith(data: unknown, locale: Locale = 'en') {
  const user = userEvent.setup();
  // A fresh Response per call: a body can be read once, and a test may read the route twice.
  fetchMock.mockImplementation(() => Promise.resolve(okResponse(data)));
  const view = mount({}, locale);
  await user.click(screen.getByRole('button', { name: locale === 'en' ? 'Show hidden sides' : 'Verborgene Seiten anzeigen' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: locale === 'en' ? 'Show' : 'Anzeigen' }));
  await screen.findByText(locale === 'en' ? 'Hidden sides shown' : 'Verborgene Seiten sichtbar');
  return { user, view };
}

const tableCells = (name: string | RegExp) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));

describe('RelationsAdmin: an admin who also plays', () => {
  it('does not see the rows that involve them until they choose to', async () => {
    await unmaskWith(BROCK_PLAYS);
    // The audited read happened (the route sent everything), but the lists leave out the admin's own rows.
    expect(tableCells('Links of Secret Santa')).toEqual([['Mara', 'Misty']]);
    expect(tableCells('Submissions for Gift')).toEqual([['Misty', 'Locked', 'Mara']]);
    expect(screen.getByText('3 rows that involve you (as giver, recipient or target) are hidden, so your own game is not spoiled.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show my rows' })).toBeTruthy();
    // The hidden rows are not in the page at all, so nothing is one tab-stop or one screen-reader pass away.
    expect(document.body.textContent).not.toContain('Brock');
  });

  it('shows their own rows on request, and hides them again with the same button', async () => {
    const { user } = await unmaskWith(BROCK_PLAYS);
    const toggle = screen.getByRole('button', { name: 'Show my rows' });
    await user.click(toggle);
    expect(tableCells('Links of Secret Santa')).toEqual([['Mara', 'Misty'], ['Misty', 'Brock']]);
    expect(tableCells('Submissions for Gift')).toEqual([
      ['Mara', 'Submitted', 'Brock'],
      ['Misty', 'Locked', 'Mara'],
      ['Brock', 'Draft', 'Misty'],
    ]);
    expect(screen.getByText('The rows that involve you are shown.')).toBeTruthy();
    // One element for both states, so keyboard focus stays where it was.
    expect(screen.getByRole('button', { name: 'Hide my rows' })).toBe(toggle);
    expect(document.activeElement).toBe(toggle);

    await user.click(toggle);
    expect(tableCells('Links of Secret Santa')).toEqual([['Mara', 'Misty']]);
    expect(screen.getByRole('button', { name: 'Show my rows' })).toBe(toggle);
  });

  it('asks again for every view: Hide again and a new read start hidden, and nothing is stored', async () => {
    const { user } = await unmaskWith(BROCK_PLAYS);
    await user.click(screen.getByRole('button', { name: 'Show my rows' }));
    expect(tableCells('Links of Secret Santa')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Hide again' }));
    await user.click(screen.getByRole('button', { name: 'Show hidden sides' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show' }));
    await screen.findByText('Hidden sides shown');
    expect(tableCells('Links of Secret Santa')).toEqual([['Mara', 'Misty']]);
    expect(screen.getByRole('button', { name: 'Show my rows' })).toBeTruthy();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('names what is hidden when every row of a list involves them', async () => {
    await unmaskWith({
      relations: [
        {
          ...relationView({ masked: false, link_count: 1 }),
          links: [{ from: { id: MISTY, name: 'Misty' }, to: { id: BROCK, name: 'Brock' }, revealed: false, involves_viewer: true }],
        },
      ],
      submissions: [
        { action: 'gift', rows: [{ player: { id: BROCK, name: 'Brock' }, state: 'draft', target: null, involves_viewer: true }] },
      ],
    });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByText('The rows that involve you are hidden.')).toHaveLength(2);
    expect(screen.queryByText('No links yet.')).toBeNull();
    expect(screen.queryByText('No player can act on this yet.')).toBeNull();
    expect(document.body.textContent).not.toContain('Brock');
  });

  it('is in German too', async () => {
    const { user } = await unmaskWith(BROCK_PLAYS, 'de');
    expect(screen.getByText(/3 Zeilen, die dich betreffen/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Meine Zeilen anzeigen' }));
    expect(screen.getByText('Die Zeilen, die dich betreffen, sind sichtbar.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Meine Zeilen ausblenden' })).toBeTruthy();
  });

  it('shows everything at once to an admin who does not play, with no control to reveal', async () => {
    await unmaskWith(UNMASKED);
    expect(tableCells('Links of Secret Santa')).toEqual([['Mara', 'Misty'], ['Misty', 'Brock']]);
    expect(tableCells('Submissions for Gift')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /my rows|Meine Zeilen/ })).toBeNull();
    expect(document.querySelector('[data-own-rows]')).toBeNull();
  });
});

describe('RelationsAdmin: the server page is read again', () => {
  it('drops the unmasked snapshot, which was read against the old state', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse(UNMASKED));
    const { rerender } = mount({ relations: [relationView()] });
    await user.click(screen.getByRole('button', { name: 'Show hidden sides' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('Hidden sides shown')).toBeTruthy();

    // Another island of the tab wrote and the page was read again: new props, the masked view comes back.
    rerender(
      withI18n(<RelationsAdmin seasonId={SEASON} relations={[relationView()]} actions={ACTIONS} canReveal roster={ROSTER} />),
    );
    expect(screen.queryByText('Hidden sides shown')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show hidden sides' })).toBeTruthy();
    expect(screen.queryByText('Brock')).toBeNull();
  });
});

describe('RelationsAdmin: reveal', () => {
  it('records a reveal with the reason, then reads the page again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a1' }, 201));
    mount();
    await user.click(screen.getByRole('button', { name: 'Reveal Secret Santa' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reveal' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Week 4 started');
    await user.click(confirm);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock)).toEqual({
      url: `/api/seasons/${SEASON}/format/adjustments`,
      method: 'POST',
      body: { reason: 'Week 4 started', adjustment: { kind: 'relation', relation: 'santa', reveal: true } },
    });
    expect(screen.getByText('Secret Santa revealed.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a later failed reveal does not sit next to the success line of the earlier one', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(okResponse({ adjustment_id: 'a1' }, 201))
      .mockResolvedValueOnce(failResponse(409, 'format_adjust_relation_has_links', 'This relation already has links, and existing links cannot be changed.'));
    mount();
    for (const round of [1, 2]) {
      await user.click(screen.getByRole('button', { name: 'Reveal Secret Santa' }));
      const dialog = screen.getByRole('dialog');
      await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Week 4 started');
      await user.click(within(dialog).getByRole('button', { name: 'Reveal' }));
      if (round === 1) await screen.findByText('Secret Santa revealed.');
    }
    expect((await screen.findByRole('alert')).textContent).toContain('already has links');
    expect(screen.queryByText('Secret Santa revealed.')).toBeNull();
  });

  it('is not offered when the format does not allow it, or the relation has no links', () => {
    mount({ canReveal: false });
    expect(screen.queryByRole('button', { name: /^Reveal/ })).toBeNull();
  });

  it('a relation without links has nothing to reveal', () => {
    mount({ relations: [relationView({ link_count: 0 })] });
    expect(screen.queryByRole('button', { name: /^Reveal/ })).toBeNull();
    expect(screen.getByText('No links yet.')).toBeTruthy();
  });

  it('a refusal stays in the dialog so the admin can fix the reason', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(409, 'format_adjust_relation_has_links', 'This relation already has links, and existing links cannot be changed.'));
    mount();
    await user.click(screen.getByRole('button', { name: 'Reveal Secret Santa' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Reveal' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('already has links');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('RelationsAdmin: draw', () => {
  const undrawn = () => relationView({ link_count: 0 });

  it('records a draw with the reason, shows no mapping, then reads the page again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a1' }, 201));
    mount({ relations: [undrawn()] });
    await user.click(screen.getByRole('button', { name: 'Draw Secret Santa' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Draw' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Signups closed');
    // A reason alone is not enough: the roster count has to be typed back.
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await user.type(within(dialog).getByRole('textbox', { name: /Type 4 to confirm/ }), '4');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.click(confirm);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock)).toEqual({
      url: `/api/seasons/${SEASON}/format/adjustments`,
      method: 'POST',
      body: { reason: 'Signups closed', adjustment: { kind: 'relation', relation: 'santa', draw: true } },
    });
    expect(screen.getByText('Secret Santa drawn.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the roster and its count before the irreversible draw', async () => {
    const user = userEvent.setup();
    mount({ relations: [undrawn()] });
    await user.click(screen.getByRole('button', { name: 'Draw Secret Santa' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Players in the draw (4)')).toBeTruthy();
    const names = within(within(dialog).getByRole('list')).getAllByRole('listitem').map((li) => li.textContent);
    expect(names).toEqual(['Mara', 'Misty', 'Brock', 'former player']);
    expect(within(dialog).getByText(/not on this list when you draw gets no link/)).toBeTruthy();
  });

  it('keeps Draw disabled for a wrong count, and sends nothing', async () => {
    const user = userEvent.setup();
    mount({ relations: [undrawn()] });
    await user.click(screen.getByRole('button', { name: 'Draw Secret Santa' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Signups closed');
    await user.type(within(dialog).getByRole('textbox', { name: /Type 4 to confirm/ }), '3');
    const confirm = within(dialog).getByRole('button', { name: 'Draw' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await user.click(confirm);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forgets the typed count when the dialog is opened again', async () => {
    const user = userEvent.setup();
    mount({ relations: [undrawn()] });
    await user.click(screen.getByRole('button', { name: 'Draw Secret Santa' }));
    await user.type(within(screen.getByRole('dialog')).getByRole('textbox', { name: /Type 4 to confirm/ }), '4');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Draw Secret Santa' }));
    expect((within(screen.getByRole('dialog')).getByRole('textbox', { name: /Type 4 to confirm/ }) as HTMLInputElement).value).toBe('');
  });

  it('says so when the roster is empty, and asks for 0', async () => {
    const user = userEvent.setup();
    mount({ relations: [undrawn()], roster: [] });
    await user.click(screen.getByRole('button', { name: 'Draw Secret Santa' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Nobody is on the roster yet/)).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: /Type 0 to confirm/ })).toBeTruthy();
  });

  it('is offered only for a relation without links that the server can draw', () => {
    const manual = mount({ relations: [relationView({ link_count: 0, shape: 'manual' })] });
    expect(screen.queryByRole('button', { name: /^Draw/ })).toBeNull();
    manual.unmount();
    const drawn = mount({ relations: [relationView({ link_count: 2 })] });
    expect(screen.queryByRole('button', { name: /^Draw/ })).toBeNull();
    drawn.unmount();
    mount({ relations: [undrawn()], canReveal: false });
    expect(screen.queryByRole('button', { name: /^Draw/ })).toBeNull();
  });

  it('a refusal stays in the dialog', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(409, 'format_adjust_relation_has_links', 'This relation already has links, and existing links cannot be changed.'));
    mount({ relations: [undrawn()] });
    await user.click(screen.getByRole('button', { name: 'Draw Secret Santa' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'x');
    await user.type(within(dialog).getByRole('textbox', { name: /Type 4 to confirm/ }), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Draw' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('already has links');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('speaks German', async () => {
    const user = userEvent.setup();
    mount({ relations: [undrawn()] }, 'de');
    await user.click(screen.getByRole('button', { name: 'Secret Santa auslosen' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/aus dem Liga-Seed ausgelost/)).toBeTruthy();
    expect(within(dialog).getByText('Spieler in der Auslosung (4)')).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: /Tippe 4 ein/ })).toBeTruthy();
    expect(within(within(dialog).getByRole('list')).getAllByRole('listitem').at(-1)?.textContent).toBe('ehemaliger Spieler');
  });
});

describe('RelationsAdmin: other states', () => {
  it('a format with neither relations nor actions says so', () => {
    mount({ relations: [], actions: [] });
    expect(screen.getByText('This format has no relations.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show hidden sides' })).toBeNull();
  });

  it('renders in German', () => {
    mount({ relations: [relationView({ label: text('Wichtel') })] }, 'de');
    expect(screen.getByRole('button', { name: 'Verborgene Seiten anzeigen' })).toBeTruthy();
    expect(screen.getByText('3 Verknüpfungen')).toBeTruthy();
  });
});

describe('RelationsAdmin: focus after the work is done', () => {
  const status = () => screen.getByRole('status');

  it('confirming "Show hidden sides" puts focus on the status line, since the button it came from is replaced', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse(UNMASKED));
    mount();
    await user.click(screen.getByRole('button', { name: 'Show hidden sides' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show' }));
    await screen.findByText('Hidden sides shown');
    await waitFor(() => expect(document.activeElement).toBe(status()));
  });

  it('"Hide again" puts focus on the status line before its own button goes', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse(UNMASKED));
    mount();
    await user.click(screen.getByRole('button', { name: 'Show hidden sides' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show' }));
    await screen.findByText('Hidden sides shown');
    await user.click(screen.getByRole('button', { name: 'Hide again' }));
    expect(document.activeElement).toBe(status());
  });

  it('a successful reveal and a successful draw leave focus on the status line, not on the opener', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a1' }, 201));
    mount();
    await user.click(screen.getByRole('button', { name: 'Reveal Secret Santa' }));
    await user.type(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Reason' }), 'Week 4 started');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reveal' }));
    await screen.findByText('Secret Santa revealed.');
    await waitFor(() => expect(document.activeElement).toBe(status()));
  });

  it('a successful draw leaves focus on the status line', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ adjustment_id: 'a1' }, 201));
    mount({ relations: [relationView({ link_count: 0 })] });
    await user.click(screen.getByRole('button', { name: 'Draw Secret Santa' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Signups closed');
    await user.type(within(dialog).getByRole('textbox', { name: /Type 4 to confirm/ }), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Draw' }));
    await screen.findByText('Secret Santa drawn.');
    await waitFor(() => expect(document.activeElement).toBe(status()));
  });
});
