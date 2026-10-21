/**
 * The bracket match card is a link whose accessible name is everything
 * inside it. The avatars sit beside the printed player names, so they are
 * decorative: their English "X's avatar" text must not join the link's name,
 * least of all on the German plaza hub, whose subtree is lang="de" and whose
 * card labels are German (PR #65 review, hub localisation).
 *
 * Rendered through react-dom/server; the accessible name is approximated by
 * walking the markup and skipping aria-hidden subtrees, as browsers do.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BracketMatchCard from '../BracketMatchCard';
import type { PublicMatch } from '@/lib/match/public-match';

const STAMP = '2026-01-01T00:00:00Z';

const MATCH: PublicMatch = {
  id: 'm1',
  round_id: 'r1',
  tournament_id: 't1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  winner_id: 'p1',
  status: 'completed',
  date_played: STAMP,
  scheduled_at: null,
  social_image_url: null,
  bracket_side: 'winners',
  bracket_pos: 0,
  created_at: STAMP,
  updated_at: STAMP,
  player_1_name: 'Anna',
  player_2_name: 'Ben',
  player_1_avatar_url: 'https://example.supabase.co/storage/v1/object/public/avatars/anna.webp',
  player_2_avatar_url: null,
  winner_name: 'Anna',
  round_status: 'completed',
  games: [],
} as PublicMatch;

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source']);

/** Text and img alt text a screen reader would read, skipping aria-hidden subtrees. */
function accessibleText(html: string): string {
  const out: string[] = [];
  let hiddenDepth = 0;
  const token = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(token)) {
    const [, closing, tag, attrs = '', selfClosing, text] = m;
    if (text !== undefined) {
      if (hiddenDepth === 0) out.push(text);
      continue;
    }
    const name = tag.toLowerCase();
    if (closing) {
      if (hiddenDepth > 0) hiddenDepth--;
      continue;
    }
    const hidden = /\saria-hidden="true"/.test(attrs);
    if (hiddenDepth === 0 && !hidden) {
      const alt = /\salt="([^"]*)"/.exec(attrs)?.[1];
      if (name === 'img' && alt) out.push(alt);
      const label = /\saria-label="([^"]*)"/.exec(attrs)?.[1];
      if (label) out.push(label);
    }
    if (VOID.has(name) || selfClosing) continue;
    if (hiddenDepth > 0 || hidden) hiddenDepth++;
  }
  return out.join(' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

describe('BracketMatchCard accessible name', () => {
  it('keeps the decorative avatars out of the link name and still names the players', () => {
    const html = renderToStaticMarkup(
      <BracketMatchCard match={MATCH} tournamentId="t1" statusLabels={null} />,
    );
    // The image avatar and the initials fallback both render.
    expect(html).toContain('<img');
    expect(html).toContain('anna.webp');

    const name = accessibleText(html);
    expect(name).not.toMatch(/avatar/i);
    expect(name).toContain('Anna');
    expect(name).toContain('Ben');
  });

  it('the helper counts an unhidden avatar alt, so the check above can fail', () => {
    expect(accessibleText('<a><img alt="Anna&#x27;s avatar"/>Anna</a>')).toBe("Anna's avatar Anna");
    expect(accessibleText('<a><span aria-hidden="true"><img alt="x"/></span>Anna</a>')).toBe('Anna');
  });
});
