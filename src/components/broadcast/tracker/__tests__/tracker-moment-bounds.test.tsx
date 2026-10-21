import { describe, it, expect } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import TrackerControls from '../TrackerControls';
import { MOMENT_DESCRIPTION_MAX_LENGTH, MOMENT_MAX_PER_GAME } from '@/lib/broadcast/moment-limits';
import type { BroadcastMomentInsert, TrackerState } from '@/types/broadcast';

function trackerState(momentCount: number): TrackerState {
  const moment: BroadcastMomentInsert = { match_id: 'm1', moment_type: 'highlight', created_by: '' };
  return {
    match_id: 'm1',
    games_submitted: [],
    current_game: {
      game_number: 1,
      turn: 3,
      player1: { player_id: 'p1', player_name: 'Alice', avatar_url: null, slots: [] },
      player2: { player_id: 'p2', player_name: 'Bob', avatar_url: null, slots: [] },
      moments: Array.from({ length: momentCount }, () => moment),
    },
    history: [],
  };
}

const noop = () => {};
const submit = async () => {};

function render(momentCount: number, locale: 'en' | 'de' = 'en') {
  return renderWithI18n(
    <TrackerControls state={trackerState(momentCount)} dispatch={noop} onSubmitGame={submit} producerMode />,
    { locale },
  );
}

function momentButtons(html: string): string[] {
  return html.match(/<button type="button"[^>]*>[^<]*<\/button>/g)?.filter((b) => b.includes('px-3 py-1.5')) ?? [];
}

describe('TrackerControls moment bounds', () => {
  it('caps the note input at the server description limit', () => {
    expect(render(0)).toContain(`maxLength="${MOMENT_DESCRIPTION_MAX_LENGTH}"`);
  });

  it('keeps the moment buttons enabled below the per-game limit', () => {
    const html = render(MOMENT_MAX_PER_GAME - 1);
    const buttons = momentButtons(html);
    expect(buttons).toHaveLength(5);
    expect(buttons.every((b) => !b.includes('disabled=""'))).toBe(true);
    expect(html).not.toContain('Moment limit reached');
  });

  it('disables the moment buttons and says why once the per-game limit is reached', () => {
    const en = render(MOMENT_MAX_PER_GAME);
    const buttons = momentButtons(en);
    expect(buttons).toHaveLength(5);
    expect(buttons.every((b) => b.includes('disabled=""'))).toBe(true);
    expect(en).toContain(`Moment limit reached (${MOMENT_MAX_PER_GAME} per game).`);

    const de = render(MOMENT_MAX_PER_GAME, 'de');
    expect(de).toContain(`Höchstzahl an Momenten erreicht (${MOMENT_MAX_PER_GAME} pro Partie).`);
  });
});
