/** @vitest-environment jsdom */
/**
 * Saving seeds, seeding by rating and re-importing the table on a started phase of the league's format: the server refuses
 * each with 409 `format_phase_owned`, the table asks for a reason and repeats the request as an audited force.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeedingTable from '../SeedingTable';
import { withI18n } from '@/test/i18n';
import type { AdminTournamentParticipant } from '@/lib/players/public-player';

const roster = [
  { id: 'p1', name: 'Alice', avatar_url: null, seed: 1, starting_bracket: 'winners', is_guest: false },
  { id: 'p2', name: 'Bob', avatar_url: null, seed: 2, starting_bracket: 'winners', is_guest: false },
] as AdminTournamentParticipant[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const owned = () => json({ success: false, error: 'This phase belongs to the format of this league', code: 'format_phase_owned' }, 409);

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** Answers every write `format_phase_owned` until it carries `force`, then 200. */
function stubApi() {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        url,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      calls.push(call);
      if (call.method === 'GET') return json({ success: true, data: roster });
      if (call.body?.force !== true) return owned();
      if (url.endsWith('/seed-by-rating')) return json({ success: true, data: { seeds: [] } });
      if (url.endsWith('/sync-standings')) {
        return json({ success: true, data: { enrolled_count: 2, enrollment_source: { frozen: false, synced_at: null }, source_phase_name: null } });
      }
      return json({ success: true, data: null });
    }),
  );
  return calls;
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== 'GET');

function mount(props: { startedFormatPhase?: boolean } = {}) {
  return render(
    withI18n(
      <SeedingTable
        tournamentId="t-1"
        seasonId="s-1"
        enrollmentSource={{ frozen: true, synced_at: null } as never}
        sourcePhaseName={null}
        participants={roster}
        ratings={{}}
        allPlayers={[]}
        onParticipantsChange={vi.fn()}
        onEnrollmentChange={vi.fn()}
        onAddPlayer={vi.fn(async () => {})}
        onRemovePlayer={vi.fn(async () => {})}
        editable
        startedFormatPhase={props.startedFormatPhase ?? true}
      />,
    ),
  );
}

async function confirmWith(user: ReturnType<typeof userEvent.setup>, reason: string) {
  expect(await screen.findByRole('dialog', { name: 'Change the roster of a started phase' })).toBeTruthy();
  await user.type(screen.getByRole('textbox', { name: /Reason/ }), reason);
  await user.click(screen.getByRole('button', { name: 'Change roster anyway' }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SeedingTable on a started phase of the league format', () => {
  it('explains that the format owns the roster', () => {
    mount();
    expect(screen.getByText(/The league format owns its roster/)).toBeTruthy();
  });

  it('saves seeds: plain request first, then the forced one with the reason after the admin confirmed', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await confirmWith(user, 'Re-seed after the late entry');

    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    const [plain, forced] = writes(calls);
    expect(plain.body).not.toHaveProperty('force');
    expect(forced).toMatchObject({ method: 'PATCH', url: '/api/tournaments/t-1/participants' });
    expect(forced.body).toMatchObject({ force: true, reason: 'Re-seed after the late entry' });
    expect(forced.body?.seeds).toEqual(plain.body?.seeds);
  });

  it('seeds by rating the same way', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole('button', { name: 'Seed by rating' }));
    await confirmWith(user, 'Ratings changed');

    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[0].body).toBeNull();
    expect(writes(calls)[1]).toMatchObject({
      method: 'POST',
      url: '/api/seasons/s-1/phases/t-1/participants/seed-by-rating',
      body: { force: true, reason: 'Ratings changed' },
    });
  });

  it('re-imports the table with one dialog (the reason is the confirmation, no second prompt)', async () => {
    const calls = stubApi();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole('button', { name: 'Re-import from table' }));
    await confirmWith(user, 'Group stage corrected');

    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]).toMatchObject({
      url: '/api/seasons/s-1/phases/t-1/participants/sync-standings',
      body: { force: true, reason: 'Group stage corrected' },
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('retries nothing when the dialog is cancelled', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole('button', { name: 'Seed by rating' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes(calls)).toHaveLength(1);
  });
});
