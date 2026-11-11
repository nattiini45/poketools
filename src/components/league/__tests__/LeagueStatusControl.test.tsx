/**
 * `LeagueStatusControl`: the status segmented control of a league. Without the `blocked` prop every status can be
 * chosen; with it, a blocked status is a disabled segment that points at its reason.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import LeagueStatusControl from '../LeagueStatusControl';

const REASON = 'Attach a format first. A custom league cannot start without one.';

function buttonsOf(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? [];
}

describe('LeagueStatusControl without the blocked prop', () => {
  it('is a labelled group with one segment per league status, the current one pressed', () => {
    const out = renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="upcoming" />);
    const labelledBy = /role="group" aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(out).toContain(`<span id="${labelledBy}" class="sr-only">Status:</span>`);
    const buttons = buttonsOf(out);
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => /aria-pressed="(true|false)"/.exec(button)?.[1])).toEqual(['true', 'false', 'false']);
    expect(out).toMatch(/>Upcoming<\/button>.*>Active<\/button>.*>Completed<\/button>/);
    expect(out).not.toContain('<p');
  });

  it('the pressed segment follows the current status', () => {
    const out = renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="completed" />);
    expect(buttonsOf(out).map((button) => /aria-pressed="(true|false)"/.exec(button)?.[1])).toEqual(['false', 'false', 'true']);
  });

  it('segments are 44 px tall on a phone and animate only when motion is allowed', () => {
    const out = renderWithI18n(<LeagueStatusControl seasonId="s1" currentStatus="upcoming" />);
    for (const button of buttonsOf(out)) {
      expect(button).toContain('min-h-11');
      expect(button).not.toMatch(/(?<!motion-safe:)\btransition-/);
    }
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
    expect(out).toContain(`<p id="${describedBy}" class="w-0 min-w-full basis-full text-caption text-fg-muted">${REASON}</p>`);
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
