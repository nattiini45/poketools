/**
 * The "how many submitted teams would become invalid" part of a pin move's confirmation: the loader that asks the server and
 * drops stale answers, the notice that prints the count, the shared confirm dialog and the wording of a version change.
 * Static markup (vitest 'node' env, no DOM); the dialog's Modal is replaced by a plain section so its content renders.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTranslator } from '@/i18n/core';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import type { PinChangeSummary, PinImpact } from '@/lib/ruleset-studio/pin-info';
import type { FetchLike } from '@/lib/studio-core/request';
import { renderWithI18n } from '@/test/i18n';
import { expectNoLeftovers } from '@/test/markup';

vi.mock('@/components/ui/Modal', () => ({
  default: ({ open, title, children }: { open: boolean; title?: string; children: ReactNode }) =>
    open ? <section role="dialog" aria-label={title}>{children}</section> : null,
}));

import PinConfirmDialog from '../PinConfirmDialog';
import PinImpactNotice from '../PinImpactNotice';
import { describeChange } from '../pin-change-text';
import { createPinImpactLoader, type PinImpactState } from '../use-pin-impact';

const IMPACT: PinImpact = {
  version_no: 3,
  checked: 12,
  would_break: 4,
  truncated: false,
  targets: [
    { kind: 'season', id: 's1', name: 'Summer League', checked: 8, would_break: 4 },
    { kind: 'tournament', id: 't1', name: 'Group Stage', checked: 4, would_break: 0 },
  ],
};

describe('createPinImpactLoader', () => {
  /** A fetch whose answers the test releases by hand, in any order. */
  function controlled() {
    const pending: Array<(response: Response) => void> = [];
    const f: FetchLike = () => new Promise<Response>((resolve) => pending.push(resolve));
    const answer = (index: number, data: unknown, status = 200) =>
      pending[index](new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: 'no', ...(data as object) }), { status }));
    return { f, answer };
  }
  const targets = [{ kind: 'season' as const, id: 's1' }];

  it('publishes loading, then the count', async () => {
    const states: PinImpactState[] = [];
    const { f, answer } = controlled();
    const loader = createPinImpactLoader((state) => states.push(state), f);

    const done = loader.load('def', 3, targets);
    expect(states).toEqual([{ status: 'loading' }]);
    await Promise.resolve();
    answer(0, IMPACT);
    await done;

    expect(states).toEqual([{ status: 'loading' }, { status: 'ready', impact: IMPACT }]);
  });

  it('publishes the reason when the check could not run, so a rate limit and a forbidden target stay distinguishable', async () => {
    const states: PinImpactState[] = [];
    const { f, answer } = controlled();
    const loader = createPinImpactLoader((state) => states.push(state), f);

    const done = loader.load('def', 3, targets);
    await Promise.resolve();
    answer(0, { code: 'rate_limited', params: { seconds: 30 } }, 429);
    await done;

    expect(states.at(-1)).toMatchObject({ status: 'failed', error: { code: 'rate_limited' } });
  });

  it('drops the answer of a call that a later call superseded', async () => {
    const states: PinImpactState[] = [];
    const { f, answer } = controlled();
    const loader = createPinImpactLoader((state) => states.push(state), f);

    const first = loader.load('def', 2, targets);
    const second = loader.load('def', 3, targets);
    await Promise.resolve();
    answer(1, IMPACT);
    await second;
    answer(0, { ...IMPACT, version_no: 2, would_break: 99 });
    await first;

    const ready = states.filter((state) => state.status === 'ready');
    expect(ready).toEqual([{ status: 'ready', impact: IMPACT }]);
  });

  it('drops a late answer once the dialog was closed', async () => {
    const states: PinImpactState[] = [];
    const { f, answer } = controlled();
    const loader = createPinImpactLoader((state) => states.push(state), f);

    const done = loader.load('def', 3, targets);
    loader.reset();
    await Promise.resolve();
    answer(0, IMPACT);
    await done;

    expect(states).toEqual([{ status: 'loading' }, { status: 'idle' }]);
  });
});

describe('PinImpactNotice', () => {
  const render = (state: PinImpactState, locale: 'en' | 'de' = 'en') => renderWithI18n(<PinImpactNotice state={state} version={3} />, { locale });

  it('shows nothing before the question is asked', () => {
    expect(render({ status: 'idle' })).toBe('');
  });

  it('says it is counting, in a live region', () => {
    const html = render({ status: 'loading' });
    expect(html).toContain('Checking the submitted teams against version 3');
    expect(html).toContain('aria-live="polite"');
  });

  it('says how many submitted teams would stop being valid, and which league or phase they are in', () => {
    const html = render({ status: 'ready', impact: IMPACT });
    expectNoLeftovers(html);
    expect(html).toContain('4 of 12 submitted teams would no longer be valid under version 3.');
    // Only one target is affected: no per-target list for a single name.
    expect(html).not.toContain('Summer League');
  });

  it('lists the affected targets when more than one is affected, and leaves out the unaffected ones', () => {
    const html = render({
      status: 'ready',
      impact: {
        ...IMPACT,
        would_break: 5,
        targets: [
          { kind: 'season', id: 's1', name: 'Summer League', checked: 8, would_break: 4 },
          { kind: 'tournament', id: 't1', name: 'Group Stage', checked: 4, would_break: 1 },
          { kind: 'tournament', id: 't2', name: 'Playoffs', checked: 3, would_break: 0 },
        ],
      },
    });
    expect(html).toContain('Summer League: 4 of 8');
    expect(html).toContain('Group Stage: 1 of 4');
    expect(html).not.toContain('Playoffs');
  });

  it('good news is plain: every checked team stays valid', () => {
    const html = render({ status: 'ready', impact: { ...IMPACT, would_break: 0, targets: [] } });
    expect(html).toContain('All 12 submitted teams stay valid under version 3.');
    expect(html).not.toContain('no longer be valid');
    expect(render({ status: 'ready', impact: { ...IMPACT, checked: 1, would_break: 0, targets: [] } })).toContain('The submitted team stays valid under version 3.');
  });

  it('no team under this pin is its own sentence, not "0 of 0"', () => {
    const html = render({ status: 'ready', impact: { ...IMPACT, checked: 0, would_break: 0, targets: [] } });
    expect(html).toContain('No submitted team is checked against this ruleset yet.');
    expect(html).not.toContain('0 of 0');
  });

  it('admits when the check stopped at its bound', () => {
    const html = render({ status: 'ready', impact: { ...IMPACT, truncated: true } });
    expect(html).toContain('The check stopped after 12 teams, so these numbers cover only those.');
  });

  it('names stored teams that could not be checked, in both languages, apart from the counts', () => {
    const one = render({ status: 'ready', impact: { ...IMPACT, malformed: 1 } });
    expect(one).toContain('1 stored team could not be checked: its data is not a valid team.');
    expect(render({ status: 'ready', impact: { ...IMPACT, malformed: 3 } })).toContain('3 stored teams could not be checked');
    expect(render({ status: 'ready', impact: { ...IMPACT, malformed: 2 } }, 'de')).toContain('2 gespeicherte Teams konnten nicht geprüft werden');
    // All teams unreadable: nothing was checked, and the notice still says why.
    const none = render({ status: 'ready', impact: { ...IMPACT, checked: 0, would_break: 0, malformed: 2, targets: [] } });
    expect(none).toContain('No submitted team is checked against this ruleset yet.');
    expect(none).toContain('2 stored teams could not be checked');
  });

  it('says nothing about unreadable teams when there are none (or the answer predates the field)', () => {
    expect(render({ status: 'ready', impact: { ...IMPACT, malformed: 0 } })).not.toContain('could not be checked');
    expect(render({ status: 'ready', impact: IMPACT })).not.toContain('could not be checked');
  });

  it('a check that could not run says so and gives the reason, without a count', () => {
    const html = render({ status: 'failed', error: { code: 'rate_limited', params: { seconds: 30 } } });
    expect(html).toContain('The submitted teams could not be checked. Some may become invalid under version 3.');
    expect(html).not.toMatch(/\d+ of \d+ submitted/);
  });

  it('speaks German', () => {
    const html = render({ status: 'ready', impact: IMPACT }, 'de');
    expect(html).toContain('4 von 12 eingereichten Teams wären unter Version 3 nicht mehr gültig.');
    expect(render({ status: 'ready', impact: { ...IMPACT, checked: 1, would_break: 1, targets: [] } }, 'de')).toContain(
      '1 von 1 eingereichten Teams wäre unter Version 3 nicht mehr gültig.',
    );
    expect(render({ status: 'ready', impact: { ...IMPACT, would_break: 0, targets: [] } }, 'de')).toContain('Alle 12 eingereichten Teams bleiben unter Version 3 gültig.');
    expect(render({ status: 'loading' }, 'de')).toContain('werden gegen Version 3 geprüft');
    expect(render({ status: 'ready', impact: { ...IMPACT, truncated: true } }, 'de')).toContain('Die Prüfung endete nach 12 Teams');
  });
});

describe('PinConfirmDialog', () => {
  const render = (props: { open?: boolean; impact?: PinImpactState; busy?: boolean } = {}) =>
    renderWithI18n(
      <PinConfirmDialog
        open={props.open ?? true}
        title="Update a running league?"
        version={3}
        impact={props.impact ?? { status: 'idle' }}
        busy={props.busy ?? false}
        confirmLabel="Update to version 3"
        cancelLabel="Cancel"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      >
        <p>“Summer League” has already started.</p>
      </PinConfirmDialog>,
    );
  const confirmButton = (html: string) => /<button[^>]*>Update to version 3<\/button>/.exec(html)?.[0] ?? '';

  it('is closed when it is not asked for', () => {
    expect(render({ open: false })).toBe('');
  });

  it('shows the sentences, then the count, then the choice', () => {
    const html = render({ impact: { status: 'ready', impact: IMPACT } });
    expect(html).toContain('aria-label="Update a running league?"');
    expect(html.indexOf('has already started')).toBeLessThan(html.indexOf('4 of 12 submitted teams'));
    expect(html.indexOf('4 of 12 submitted teams')).toBeLessThan(html.indexOf('Update to version 3'));
    expect(html).toContain('>Cancel</button>');
  });

  it('holds Confirm back while the teams are being counted, so the number is on screen before the decision', () => {
    expect(confirmButton(render({ impact: { status: 'loading' } }))).toContain(' disabled=""');
    expect(confirmButton(render({ impact: { status: 'ready', impact: IMPACT } }))).not.toContain(' disabled=""');
  });

  it('a count that failed does not block the move; the server confirmation still guards it', () => {
    expect(confirmButton(render({ impact: { status: 'failed', error: { code: 'rate_limited' } } }))).not.toContain(' disabled=""');
  });

  it('rests both buttons while the move is under way', () => {
    const html = render({ busy: true, impact: { status: 'ready', impact: IMPACT } });
    expect(confirmButton(html)).toContain(' disabled=""');
    expect(/<button[^>]*>Cancel<\/button>/.exec(html)?.[0]).toContain(' disabled=""');
  });
});

describe('describeChange', () => {
  const NONE: PinChangeSummary = { banned: 0, unbanned: 0, allowed: 0, disallowed: 0, clausesAdded: 0, clausesRemoved: 0, modeChanged: false, otherChanged: false };
  const en = createTranslator(rulesetMessages, 'en');
  const de = createTranslator(rulesetMessages, 'de');

  it('names only the parts that are not zero, in a fixed order', () => {
    expect(describeChange({ ...NONE, banned: 3, unbanned: 1, clausesAdded: 1 }, en)).toBe('3 more banned, 1 no longer banned, 1 clause added');
    expect(describeChange({ ...NONE, allowed: 2, disallowed: 1, clausesRemoved: 2, modeChanged: true, otherChanged: true }, en)).toBe(
      '2 more allowed, 1 no longer allowed, 2 clauses removed, a list switches between bans and an allowlist, other rules change',
    );
  });

  it('is null when the two versions enforce the same', () => {
    expect(describeChange(NONE, en)).toBeNull();
  });

  it('speaks German', () => {
    expect(describeChange({ ...NONE, banned: 3, unbanned: 1 }, de)).toBe('3 mehr gebannt, 1 nicht mehr gebannt');
  });
});
