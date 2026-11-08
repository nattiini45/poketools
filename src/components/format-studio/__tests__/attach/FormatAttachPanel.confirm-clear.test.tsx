/** @vitest-environment jsdom */
/**
 * `FormatAttachPanel`: a detach (or re-attach) over the league's draw or gifts. The server refuses it with 409
 * `format_runtime_has_data` and the counts; the panel asks the admin and sends the request again with
 * `confirm_clear: true`.
 */
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import { ltext } from '@/lib/studio-core/ltext';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import FormatAttachPanel, { type FormatAttachPanelProps } from '../../attach/FormatAttachPanel';

const SEASON = '5e150000-0000-4000-8000-000000000001';
const HASH = 'a3f9c2d41b7e8805e6d1f0c9b2a47385c6e1d0f9a8b7c6d5e4f3a2b1c0d9e8f7';

const PANEL: FormatAttachPanelProps = {
  seasonId: SEASON,
  started: false,
  rulesetId: 'ruleset-1',
  seasonLanguage: 'en',
  manualPhaseCount: 0,
  attached: {
    definition_id: 'def-1',
    version_no: 2,
    spec_hash: HASH,
    frozen_at: '2026-10-09T12:00:00.000Z',
    name: ltext('en', 'Spring Cup', 'Frühlingspokal'),
    stageCount: 3,
    createdPhases: 3,
  },
  candidates: [],
  capped: false,
  phasesHref: `/admin/leagues/${SEASON}?tab=phases`,
};

const HAS_DATA = {
  success: false,
  error: 'This league already has data from its current format. Confirm to continue.',
  code: 'format_runtime_has_data',
  params: { links: 2, items: 1, submissions: 4, adjustments: 0 },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Sent {
  method: string | undefined;
  body: unknown;
}

describe('FormatAttachPanel: confirm_clear', () => {
  const sent: Sent[] = [];
  const answers: Response[] = [];

  beforeEach(() => {
    sent.length = 0;
    answers.length = 0;
    refresh.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push({ method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
        return answers.shift() ?? json({ success: true, data: { removed_stage_ids: ['s1'] } }, 200);
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('detach: the 409 opens a confirmation, and confirming sends the request again with confirm_clear', async () => {
    answers.push(json(HAS_DATA, 409));
    const user = userEvent.setup();
    render(withI18n(<FormatAttachPanel {...PANEL} />));

    await user.click(screen.getByRole('button', { name: 'Detach' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Detach' }));

    // First request: no body, no flag.
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ method: 'DELETE', body: undefined });

    // The second dialog carries the server's counts text and its own confirm button.
    const prompt = await screen.findByText(/Confirm to continue/);
    expect(prompt).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Delete it and continue' }));

    await waitFor(() => expect(sent).toHaveLength(2));
    // The confirmation names the counts the 409 showed (links 2, items 1, submissions 4), so a table that grew meanwhile is refused again.
    expect(sent[1]).toEqual({ method: 'DELETE', body: { confirm_clear: true, confirmed_counts: { links: 2, items: 1, submissions: 4, adjustments: 0 } } });
    expect(await screen.findByText(/Format detached/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it('detach: cancelling the confirmation sends nothing more', async () => {
    answers.push(json(HAS_DATA, 409));
    const user = userEvent.setup();
    render(withI18n(<FormatAttachPanel {...PANEL} />));

    await user.click(screen.getByRole('button', { name: 'Detach' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Detach' }));
    await screen.findByText(/Confirm to continue/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText(/Confirm to continue/)).toBeNull());
    expect(sent).toHaveLength(1);
  });

  it('detach: another failure is shown as an error and offers no confirmation', async () => {
    answers.push(json({ success: false, error: 'Teams still point to a phase of this format.', code: 'format_detach_blocked' }, 409));
    const user = userEvent.setup();
    render(withI18n(<FormatAttachPanel {...PANEL} />));

    await user.click(screen.getByRole('button', { name: 'Detach' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Detach' }));

    expect(await screen.findByText(/Teams still point/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete it and continue' })).toBeNull();
    expect(sent).toHaveLength(1);
  });
});
