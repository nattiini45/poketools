/**
 * `LeagueStatusControl`: the status buttons of a league. Without the `blocked` prop the markup is exactly what it was
 * before the prop existed (a stored literal); with it, a blocked status is a disabled button that points at its reason.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import LeagueStatusControl from '../LeagueStatusControl';

/** React's generated ids differ between runs of different trees; the tests compare markup with them masked. */
const maskIds = (html: string) => html.replace(/_R_[0-9a-z]+_/g, 'ID');

const BUTTON =
  'class="inline-flex min-h-11 items-center rounded-poke-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus disabled:opacity-50 motion-safe:transition-opacity sm:min-h-0"';
const CURRENT_BADGE = (variant: string, text: string) =>
  `<span class="inline-flex items-center border font-heading font-semibold rounded-full ${variant} px-2 py-0.5 text-xs ring-2 ring-offset-1 ring-poke-border">${text}</span>`;
const OTHER_BADGE = (variant: string, text: string) =>
  `<span class="inline-flex items-center border font-heading font-semibold rounded-full ${variant} px-2 py-0.5 text-xs opacity-40 hover:opacity-70 cursor-pointer">${text}</span>`;
const GRAY = 'border-poke-border bg-poke-muted text-poke-text-muted';
const GREEN = 'border-poke-green/30 bg-poke-green-light text-poke-green';
const BLUE =
  'border-poke-blue/30 bg-poke-blue-light text-poke-blue dark:border-poke-blue/40';

/** The render of an upcoming league before the `blocked` prop was added. */
const UPCOMING_BEFORE =
  '<div class="flex flex-wrap items-center gap-2" role="group" aria-labelledby="ID">' +
  '<span id="ID" class="text-xs text-poke-text-muted font-heading">Status:</span>' +
  '<div class="flex flex-wrap gap-1">' +
  `<button type="button" aria-pressed="true" ${BUTTON}>${CURRENT_BADGE(GRAY, 'Upcoming')}</button>` +
  `<button type="button" aria-pressed="false" ${BUTTON}>${OTHER_BADGE(GREEN, 'Active')}</button>` +
  `<button type="button" aria-pressed="false" ${BUTTON}>${OTHER_BADGE(BLUE, 'Completed')}</button>` +
  '</div></div>';

const REASON = 'Attach a format first. A custom league cannot start without one.';

function buttonsOf(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? [];
}

describe('LeagueStatusControl without the blocked prop', () => {
  it('renders exactly the markup it had before', () => {
    expect(maskIds(renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="upcoming" />))).toBe(UPCOMING_BEFORE);
  });

  it('an empty blocked map changes nothing either', () => {
    const plain = renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="upcoming" />);
    expect(renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="upcoming" blocked={{}} />)).toBe(plain);
  });

  it('no button is disabled or described', () => {
    for (const button of buttonsOf(renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="upcoming" />))) {
      expect(button).not.toContain('disabled=""');
      expect(button).not.toContain('aria-describedby');
    }
  });
});

describe('LeagueStatusControl with a blocked status', () => {
  const html = () =>
    renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="upcoming" blocked={{ active: REASON }} />);

  it('the blocked Active button is disabled, not pressed, and described by the visible reason', () => {
    const out = html();
    const [upcoming, active, completed] = buttonsOf(out);
    expect(active).toContain('disabled=""');
    expect(active).toContain('aria-pressed="false"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(active)?.[1];
    expect(describedBy).toBeTruthy();
    expect(out).toContain(`<p id="${describedBy}" class="basis-full text-xs text-poke-text-muted">${REASON}</p>`);
    // The other buttons are untouched.
    for (const other of [upcoming, completed]) {
      expect(other).not.toContain('disabled=""');
      expect(other).not.toContain('aria-describedby');
    }
  });

  it('the reason sits inside the labelled group, after the buttons', () => {
    const out = html();
    expect(out.indexOf(REASON)).toBeGreaterThan(out.lastIndexOf('</button>'));
    expect(out.endsWith('</p></div>')).toBe(true);
  });

  it('the current status is never blocked', () => {
    const out = renderWithI18n(
      <LeagueStatusControl seasonId="s1" currentStatus="active" blocked={{ active: REASON }} />,
    );
    expect(out).not.toContain(REASON);
    expect(out).not.toContain('disabled=""');
  });

  it('an empty reason blocks nothing', () => {
    const out = renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="upcoming" blocked={{ active: '' }} />);
    expect(out).not.toContain('disabled=""');
  });

  it('the reason text is shown as given, in German as well', () => {
    const de = 'Hänge zuerst ein Format an.';
    const out = renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="upcoming" blocked={{ active: de }} />, {
      locale: 'de',
    });
    expect(out).toContain(de);
    expect(out).toContain('Läuft');
  });
});
