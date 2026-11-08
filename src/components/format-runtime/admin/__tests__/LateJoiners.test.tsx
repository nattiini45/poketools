/**
 * LateJoiners: the late-joiner list of the live tab. One row per player, the events they missed as sentences, the
 * effects as badges; both languages; nothing when nobody joined late.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { LateJoinerView } from '@/lib/format-engine/runtime/view-types';
import LateJoiners from '../LateJoiners';

const text = (en: string, de?: string) => ({ en: { v: en, s: 'human' as const }, ...(de ? { de: { v: de, s: 'human' as const } } : {}), base: 'en' as const });

const joiners: LateJoinerView[] = [
  {
    player: { id: 'p4', name: 'Dana' },
    missed: [
      {
        event: 'stage_start',
        stage: 'swiss',
        stage_label: text('Swiss', 'Schweizer System'),
        round: null,
        action: null,
        mark: null,
        effects: [
          { kind: 'grant_resource', key: 'coins', label: text('Coins', 'Münzen') },
          { kind: 'generate_relation', key: 'santa', label: null },
        ],
      },
      { event: 'round_start', stage: 'swiss', stage_label: text('Swiss'), round: 2, action: null, mark: null, effects: [{ kind: 'adjust_points', key: 'swiss', label: text('Swiss') }] },
    ],
  },
  { player: { id: 'p9', name: null }, missed: [{ event: 'action_locked', stage: null, stage_label: null, round: null, action: 'gift', mark: null, effects: [{ kind: 'set_attr', key: 'mood', label: text('Mood') }] }] },
];

describe('LateJoiners', () => {
  it('renders nothing when nobody joined late', () => {
    expect(renderWithI18n(<LateJoiners lateJoiners={[]} />)).toBe('');
  });

  it('names each player and the events they missed, with the effects of each', () => {
    const html = renderWithI18n(<LateJoiners lateJoiners={joiners} />);

    expect(html).toContain('Dana');
    expect(html).toContain('Start of Swiss');
    expect(html).toContain('Round 2 of Swiss started');
    expect(html).toContain('Grant of Coins');
    // A label the format does not carry falls back to the key.
    expect(html).toContain('Draw of santa');
    expect(html).toContain('Points in Swiss');
    expect(html).toContain('Action gift locked');
    expect(html).toContain('Attribute Mood');
  });

  it('calls a player the league no longer knows a former player, never an empty name', () => {
    const html = renderWithI18n(<LateJoiners lateJoiners={joiners} />);
    expect(html).toContain('former player');
    expect(html).not.toMatch(/<th[^>]*>\s*<\/th>/);
  });

  it('says it in German, with the label of the format in the viewer\'s language', () => {
    const html = renderWithI18n(<LateJoiners lateJoiners={joiners} />, { locale: 'de' });

    expect(html).toContain('Start von Schweizer System');
    expect(html).toContain('Vergabe von Münzen');
    expect(html).toContain('Runde 2 von Swiss gestartet');
    expect(html).toContain('Aktion gift gesperrt');
  });

  it('describes the table for assistive technology', () => {
    const html = renderWithI18n(<LateJoiners lateJoiners={joiners} />);
    expect(html).toContain('<caption class="sr-only">Late joiners and the events they missed</caption>');
  });
});
