/**
 * AdminMatchRowCard (server render): line one (title link, score, winner, badges), line two (only
 * the parts that exist), the back link and the markup guarantee that no anchor sits inside another.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MatchListRow } from '../AdminMatchRowCard';
import { EMPTY_MATCH_LIST_STATE, buildMatchListSearch } from '@/lib/admin/match-list';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';
import type { GameSummary } from '@/types/match';

const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOURNAMENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function game(n: number, winner: string | null, replay = `https://replay.example/${n}`): GameSummary {
  return { id: `g${n}`, game_number: n, winner_id: winner, replay_url: replay, source: 'ps_replay', stats_locked: false };
}

function row(overrides: Partial<AdminMatchRow> = {}): AdminMatchRow {
  return {
    id: MATCH,
    round_id: 'round-1',
    tournament_id: TOURNAMENT,
    player_1_id: P1,
    player_2_id: P2,
    winner_id: null,
    status: 'scheduled',
    submitter_id: null,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    player_1_name: 'Mara',
    player_2_name: 'Joel',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: null,
    round_status: 'active',
    games: [],
    tournament_name: 'Spring Cup',
    season_id: 'season-1',
    season_name: 'Spring League',
    season_is_test: false,
    archived: false,
    round_name: 'Round 3',
    round_number: 3,
    best_of: 3,
    round_deadline: null,
    ...overrides,
  };
}

const render = (r: AdminMatchRow, backQuery = '', locale: 'en' | 'de' = 'en') =>
  renderWithI18n(<MatchListRow row={r} backQuery={backQuery} />, { locale, requestTime: NOW });

/** The text of line two (the muted paragraph). */
function detailsOf(html: string): string {
  const match = /<p class="text-\[11px\][^>]*>(.*?)<\/p>/.exec(html);
  if (!match) throw new Error('line two not found');
  let text = match[1].replace(/<span[^>]*aria-hidden="true"[^>]*>·<\/span>/g, ' · ');
  // Repeat until no tag is left (the loop is the shape CodeQL expects for multi-character stripping).
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]+>/g, '');
  } while (text !== previous);
  return text;
}

describe('AdminMatchRowCard line one', () => {
  it('shows the pairing, the score, the winner and the status', () => {
    const html = render(
      row({
        status: 'completed',
        winner_id: P1,
        winner_name: 'Mara',
        games: [game(1, P1), game(2, P2), game(3, P1)],
      }),
    );
    expect(html).toContain('>Mara vs Joel</a>');
    expect(html).toContain('2–1');
    expect(html).toContain('W: Mara');
    expect(html).toContain('Completed');
  });

  it('shows no score without games', () => {
    expect(render(row())).not.toMatch(/\d–\d/);
  });

  it('badges test leagues and archived rows', () => {
    const plain = render(row());
    expect(plain).not.toContain('>Test<');
    expect(plain).not.toContain('>Archived<');
    const flagged = render(row({ season_is_test: true, archived: true }));
    expect(flagged).toContain('>Test<');
    expect(flagged).toContain('>Archived<');
  });
});

describe('AdminMatchRowCard line two', () => {
  it('joins league / phase, round, best-of, time, replays and the auto-confirm countdown', () => {
    const html = render(
      row({
        status: 'pending_confirmation',
        scheduled_at: '2026-10-25T18:00:00.000Z',
        auto_confirm_at: new Date(NOW + 5 * 3_600_000).toISOString(),
        games: [game(1, P1), game(2, P1)],
      }),
    );
    const parts = detailsOf(html).split(' · ');
    expect(parts[0]).toBe('Spring League / Spring Cup');
    expect(parts[1]).toBe('Round 3');
    expect(parts[2]).toBe('Bo3');
    expect(parts[3]).toMatch(/Oct/);
    expect(parts[4]).toBe('2 replays');
    expect(parts[5]).toBe('auto-confirms in 5 h');
    expect(parts).toHaveLength(6);
    expect(html).toContain('<time dateTime="2026-10-25T18:00:00.000Z"');
  });

  it('renders only the parts that exist, with no dangling separator', () => {
    const html = render(row({ round_name: '', round_number: 0, best_of: 1, scheduled_at: null }));
    expect(detailsOf(html)).toBe('Spring League / Spring Cup · Bo1');
    expect(html.match(/aria-hidden="true" class="mx-1">·/g)).toHaveLength(1);
  });

  it('uses the tournament name alone for a standalone tournament and falls back to the round number', () => {
    const html = render(row({ season_name: null, season_id: null, round_name: '', round_number: 4 }));
    expect(detailsOf(html)).toBe('Spring Cup · Round 4 · Bo3');
  });

  it('counts one replay in the singular and skips games without a link', () => {
    const html = render(row({ games: [game(1, P1), game(2, P2, '')] }));
    expect(detailsOf(html)).toContain('1 replay');
    expect(detailsOf(html)).not.toContain('replays');
    expect(detailsOf(render(row({ games: [game(1, P1, '')] })))).not.toContain('replay');
  });

  it('shows the auto-confirm text for the three countdown states', () => {
    const pending = (offsetMs: number) =>
      detailsOf(
        render(row({ status: 'pending_confirmation', auto_confirm_at: new Date(NOW + offsetMs).toISOString() })),
      );
    expect(pending(23 * 3_600_000 + 10 * 60_000)).toContain('auto-confirms in 24 h');
    expect(pending(20 * 60_000)).toContain('auto-confirms in under 1 h');
    expect(pending(-60_000)).toContain('auto-confirm due');
    // Other statuses and a pending match without a moment show nothing.
    expect(detailsOf(render(row({ status: 'in_progress', auto_confirm_at: new Date(NOW + 3_600_000).toISOString() })))).not.toContain('auto-confirm');
    expect(detailsOf(render(row({ status: 'pending_confirmation', auto_confirm_at: null })))).not.toContain('auto-confirm');
  });

  it('translates the round name and the texts into German', () => {
    const html = render(
      row({
        status: 'pending_confirmation',
        auto_confirm_at: new Date(NOW + 5 * 3_600_000).toISOString(),
        games: [game(1, P1), game(2, P1)],
        winner_id: P1,
        winner_name: 'Mara',
      }),
      '',
      'de',
    );
    expect(html).toContain('>Mara vs. Joel</a>');
    expect(detailsOf(html)).toContain('Runde 3');
    expect(detailsOf(html)).toContain('2 Replays');
    expect(detailsOf(html)).toContain('bestätigt sich in 5 Std.');
    expect(html).toContain('S: Mara');
    expect(html).toContain('aria-label="Öffentliche Seite von Mara vs. Joel"');
  });
});

describe('AdminMatchRowCard layout on a phone', () => {
  const classesOf = (html: string, marker: string) => {
    const tag = new RegExp(`<[a-z]+ class="([^"]*${marker}[^"]*)"`).exec(html);
    if (!tag) throw new Error(`no element with ${marker}`);
    return tag[1].split(/\s+/);
  };

  it('lets line one wrap so the badges drop under the title', () => {
    const html = render(row({ winner_id: P1, winner_name: 'Mara' }));
    expect(classesOf(html, 'justify-between')).toContain('flex-wrap');
    const group = classesOf(html, 'min-w-0 max-w-full');
    expect(group).toContain('flex-wrap');
  });

  it('stacks line two on a phone and puts the actions beside it from sm up', () => {
    const html = render(row({ status: 'in_progress' }));
    const line = classesOf(html, 'sm:flex-row');
    expect(line).toContain('flex-col');
    const actions = classesOf(html, 'sm:shrink-0');
    expect(actions).toContain('flex-wrap');
    expect(actions).not.toContain('shrink-0');
  });
});

describe('AdminMatchRowCard links', () => {
  it('opens the admin page with the canonical list query as back', () => {
    const back = buildMatchListSearch({ ...EMPTY_MATCH_LIST_STATE, status: 'disputed', page: 2 });
    expect(back).toBe('status=disputed&page=2');
    const html = render(row(), back);
    expect(html).toContain(`href="/admin/matches/${MATCH}?back=status%3Ddisputed%26page%3D2"`);
  });

  it('omits back for an empty list query', () => {
    expect(render(row(), '')).toContain(`href="/admin/matches/${MATCH}"`);
    expect(render(row(), '')).not.toContain('back=');
  });

  it('links the public page with an accessible name, above the stretched link', () => {
    const html = render(row());
    expect(html).toContain(`href="/tournaments/${TOURNAMENT}/matches/${MATCH}"`);
    expect(html).toContain('aria-label="Public page of Mara vs Joel"');
    // Secondary links sit above the stretched hit area of the title link.
    const publicLink = /<a [^>]*href="\/tournaments[^>]*>/.exec(html)?.[0] ?? '';
    expect(publicLink).toContain('relative z-10');
  });

  it('offers submit and prep for scheduled and in-progress matches only', () => {
    for (const status of ['scheduled', 'in_progress'] as const) {
      const html = render(row({ status }));
      expect(html).toContain(`href="/dashboard/submit/${MATCH}"`);
      expect(html).toContain(`href="/dashboard/match-prep/${MATCH}"`);
    }
    for (const status of ['pending_confirmation', 'completed', 'disputed'] as const) {
      const html = render(row({ status }));
      expect(html).not.toContain('/dashboard/submit/');
      expect(html).not.toContain('/dashboard/match-prep/');
    }
    expect(render(row())).not.toContain('Override');
  });

  it('never nests an anchor in an anchor, and has exactly one admin-page anchor', () => {
    const html = render(row({ status: 'in_progress' }), 'status=in_progress');
    let depth = 0;
    for (const tag of html.matchAll(/<a[\s>]|<\/a>/g)) {
      depth += tag[0] === '</a>' ? -1 : 1;
      expect(depth).toBeLessThanOrEqual(1);
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    expect(html.match(/href="\/admin\/matches\//g)).toHaveLength(1);
    // The primary anchor carries the stretched hit area.
    expect(/<a [^>]*href="\/admin\/matches\/[^>]*>/.exec(html)?.[0]).toContain('after:absolute after:inset-0');
    expect(html).toMatch(/<div class="[^"]*\brelative\b/);
  });
});

describe('AdminMatchRowCard selection checkbox', () => {
  const select = (checked: boolean, r: AdminMatchRow = row(), locale: 'en' | 'de' = 'en') =>
    renderWithI18n(<MatchListRow row={r} backQuery="" selection={{ checked, onChange: () => {} }} />, {
      locale,
      requestTime: NOW,
    });
  const checkboxes = (html: string) => html.match(/<input [^>]*type="checkbox"[^>]*>/g) ?? [];

  it('renders no checkbox without the selection prop, and the row is unchanged', () => {
    const plain = render(row());
    expect(checkboxes(plain)).toHaveLength(0);
    expect(plain).not.toContain('ring-1');
  });

  it('renders one checkbox named after the pairing, in English and German', () => {
    const en = checkboxes(select(false));
    expect(en).toHaveLength(1);
    expect(en[0]).toContain('aria-label="Select Mara vs Joel"');
    const de = checkboxes(select(false, row(), 'de'));
    expect(de[0]).toContain('aria-label="Mara vs. Joel auswählen"');
  });

  it('follows the checked prop and outlines a selected row without a fixed dark background', () => {
    expect(checkboxes(select(false))[0]).not.toContain('checked=""');
    expect(checkboxes(select(true))[0]).toContain('checked=""');
    const selected = select(true);
    expect(selected).toContain('border-poke-border-focus ring-1 ring-poke-border-focus');
    expect(select(false)).not.toContain('ring-1');
    expect(selected).not.toMatch(/bg-(black|slate|gray|zinc|neutral)-/);
  });

  it('keeps the checkbox out of every anchor and above the stretched title link', () => {
    const html = select(false, row({ status: 'in_progress' }));
    let depth = 0;
    let inputInsideAnchor = false;
    for (const tag of html.matchAll(/<a[\s>]|<\/a>|<input /g)) {
      if (tag[0] === '<input ') inputInsideAnchor ||= depth > 0;
      else depth += tag[0] === '</a>' ? -1 : 1;
    }
    expect(inputInsideAnchor).toBe(false);
    const input = checkboxes(html)[0];
    expect(input).toContain('relative z-10');
    // The hit area around the box is at least 32px.
    expect(/<label class="([^"]*)"/.exec(html)?.[1]).toMatch(/\bh-8\b.*\bw-8\b|\bw-8\b.*\bh-8\b/);
    // The checkbox comes before the title link.
    expect(html.indexOf('type="checkbox"')).toBeLessThan(html.indexOf(`href="/admin/matches/${MATCH}"`));
  });
});
