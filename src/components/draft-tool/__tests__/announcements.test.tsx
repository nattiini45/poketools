import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from '@/i18n/core';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { timeMessages } from '@/i18n/messages/time';
import { buildFixtureCatalog, stubNames } from '@/lib/draft-finder/__tests__/fixture-index';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { DraftSnapshotDTO, LineId } from '@/lib/draft-ui/snapshot-types';
import { DAWN, MISTY, OTHER, snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import { announcementsText, announcementText, diffAnnouncements, type AnnouncementTextDeps } from '../feedback/announcements';
import LiveAnnouncer from '../feedback/LiveAnnouncer';

const catalog = buildFixtureCatalog();
const byId = new Map<LineId, DraftLineCatalogEntry>(catalog.lines.map((l) => [l.lineId, l]));
const entryOf = (id: LineId) => byId.get(id);
const vmOf = (dto: DraftSnapshotDTO) => toDraftViewModel(dto, catalog);

function deps(locale: 'en' | 'de'): AnnouncementTextDeps {
  return {
    t: createTranslator(draftScreenMessages, locale),
    tTime: createTranslator(timeMessages, locale),
    names: stubNames,
    dl: locale,
  };
}

/** Dawn on the clock at pick 3 (version 41), as seen by `viewer`. */
function before(viewer: string): DraftSnapshotDTO {
  const base = snapshot();
  return snapshot({ state_version: 41, viewer: { ...base.viewer, player_id: viewer, is_participant: viewer !== OTHER } });
}

/** Dawn drafted Samurott with pick 3; pick 4 goes to `nextPlayer` (version 42). */
function after(viewer: string, nextPlayer: string): DraftSnapshotDTO {
  const prev = before(viewer);
  const slot = prev.active_slot;
  if (!slot) throw new Error('fixture has an active slot');
  return {
    ...prev,
    state_version: 42,
    active_slot: { ...slot, slot_id: 'slot-4', player_id: nextPlayer, pick_number: 4 },
    picks: [
      {
        pick_id: 'p3',
        slot_id: 'slot-3',
        pick_number: 3,
        round: 2,
        player_id: DAWN,
        line_id: 'oshawott--samurott',
        entry_id: 'e3',
        price: 20,
        made_at: '2026-10-09T12:01:00.000Z',
        admin_override: false,
        redraft_slot_id: null,
      },
      ...prev.picks,
    ],
    taken: { ...prev.taken, 'oshawott--samurott': DAWN },
  };
}

const samurott = () => {
  const entry = byId.get('oshawott--samurott');
  if (!entry) throw new Error('fixture line missing');
  return stubNames.lineLabel(entry.stages[0].name, entry.stages[2]?.name ?? null, 'en');
};

describe('diffAnnouncements', () => {
  it('keeps the pick and the next player on the clock when the next picker is someone else (§5.9)', () => {
    const d = diffAnnouncements(vmOf(before(OTHER)), vmOf(after(OTHER, MISTY)), entryOf);
    expect(d.polite.map((a) => a.kind)).toEqual(['picked', 'onClock']);
    expect(d.assertive).toBeNull();
    expect(d.yourTurn).toBe(false);
    expect(announcementsText(d.polite, deps('en'))).toBe(`Dawn drafted ${samurott()}. Misty is on the clock.`);
  });

  it('builds the same sequence in German', () => {
    const d = diffAnnouncements(vmOf(before(OTHER)), vmOf(after(OTHER, MISTY)), entryOf);
    const text = announcementsText(d.polite, deps('de'));
    expect(text).toMatch(/^Dawn hat .+ gedraftet\. Misty ist am Zug\.$/);
  });

  it('announces the pick politely and "You are on the clock" assertively when the viewer is next', () => {
    const d = diffAnnouncements(vmOf(before(MISTY)), vmOf(after(MISTY, MISTY)), entryOf);
    expect(d.polite.map((a) => a.kind)).toEqual(['picked']);
    expect(d.assertive).toEqual({ kind: 'yourTurn' });
    expect(d.yourTurn).toBe(true);
    expect(announcementText({ kind: 'yourTurn' }, deps('en'))).toBe('You are on the clock.');
  });

  it('orders several new picks by pick number', () => {
    const prev = before(OTHER);
    const two = after(OTHER, MISTY);
    const p4 = { ...two.picks[0], pick_id: 'p4', slot_id: 'slot-4', pick_number: 4, player_id: MISTY, line_id: 'dratini--dragonite' };
    const next: DraftSnapshotDTO = { ...two, state_version: 43, picks: [p4, ...two.picks] };
    const d = diffAnnouncements(vmOf(prev), vmOf(next), entryOf);
    const picked = d.polite.filter((a) => a.kind === 'picked').map((a) => (a.kind === 'picked' ? a.player : ''));
    expect(picked).toEqual(['Dawn', 'Misty']);
  });

  it('announces a pause and a resume assertively, and nothing for an unchanged state', () => {
    const running = before(OTHER);
    const pausedDto: DraftSnapshotDTO = { ...running, state_version: 42, pool: { ...running.pool, paused: true } };
    expect(diffAnnouncements(vmOf(running), vmOf(pausedDto), entryOf).assertive).toEqual({ kind: 'paused' });
    expect(diffAnnouncements(vmOf(pausedDto), vmOf(running), entryOf).assertive).toEqual({ kind: 'resumed' });
    const same = diffAnnouncements(vmOf(running), vmOf(running), entryOf);
    expect(same).toEqual({ polite: [], assertive: null, yourTurn: false });
  });

  it('never reads out a raw line id for a line missing from the catalog', () => {
    const d = diffAnnouncements(vmOf(before(OTHER)), vmOf(after(OTHER, MISTY)), () => undefined);
    const picked = d.polite[0];
    expect(picked.kind).toBe('picked');
    expect(announcementText(picked, deps('en'))).toBe('Dawn made a pick.');
    expect(announcementText(picked, deps('de'))).toBe('Dawn hat gepickt.');
    expect(announcementsText(d.polite, deps('en'))).not.toContain('oshawott--samurott');
  });

  it('phrases the timer thresholds through the time namespace', () => {
    expect(announcementText({ kind: 'oneMinute' }, deps('en'))).toBe('1 minute left');
    expect(announcementText({ kind: 'oneHour' }, deps('en'))).toBe('1 hour left');
  });
});

describe('LiveAnnouncer', () => {
  it('renders one polite and one assertive region with the text in a keyed child', () => {
    const html = renderToStaticMarkup(<LiveAnnouncer polite="Dawn drafted X. Misty is on the clock." assertive="" politeKey={3} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('<span>Dawn drafted X. Misty is on the clock.</span>');
    expect(html.match(/aria-live=/g)).toHaveLength(2);
  });
});
