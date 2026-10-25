import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATTENTION_STATUSES,
  DASHBOARD_ATTENTION_LIMIT,
  DASHBOARD_STAT_HREFS,
  attentionListHref,
} from '../dashboard';
import { EMPTY_MATCH_LIST_STATE, parseMatchListUrl } from '../match-list';

describe('attentionListHref', () => {
  it('links the Matches list filtered to one status', () => {
    expect(attentionListHref('disputed')).toBe('/admin/matches?status=disputed');
    expect(attentionListHref('pending_confirmation')).toBe('/admin/matches?status=pending_confirmation');
  });

  it.each(ATTENTION_STATUSES)('parses back through the list URL parser as the %s tab only', (status) => {
    const href = attentionListHref(status);
    const url = new URL(href, 'https://example.test');
    expect(url.pathname).toBe('/admin/matches');
    expect(parseMatchListUrl(url.searchParams)).toEqual({ ...EMPTY_MATCH_LIST_STATE, status });
  });
});

describe('dashboard constants', () => {
  it('lists the two statuses that need attention and a 20-row page', () => {
    expect([...ATTENTION_STATUSES]).toEqual(['disputed', 'pending_confirmation']);
    expect(DASHBOARD_ATTENTION_LIMIT).toBe(20);
  });

  it('points the counter cards at admin list routes and gives the games total none', () => {
    expect(DASHBOARD_STAT_HREFS).toEqual({
      players: '/admin/players',
      tournaments: '/admin/tournaments',
      activeMatches: '/admin/matches',
      leagues: '/admin/leagues',
    });
    expect('games' in DASHBOARD_STAT_HREFS).toBe(false);
  });

  it('only links admin routes that have a page', () => {
    for (const href of Object.values(DASHBOARD_STAT_HREFS)) {
      expect(existsSync(join(process.cwd(), 'src', 'app', href, 'page.tsx')), href).toBe(true);
    }
  });
});
