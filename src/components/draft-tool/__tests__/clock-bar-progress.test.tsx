import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { DAWN, MISTY, snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import ClockBar from '../layout/ClockBar';
import UpcomingOrderStrip from '../layout/UpcomingOrderStrip';
import { NOTIFY_UNSUPPORTED } from '../hooks/use-turn-watch';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';

const noop = () => {};

function clockBar(dto: DraftSnapshotDTO, locale: 'en' | 'de' = 'en') {
  return renderWithI18n(
    <ClockBar vm={toDraftViewModel(dto)} clock={null} notify={NOTIFY_UNSUPPORTED} onNotifyToggle={noop} onExtension={noop} onOpenPlayers={noop} />,
    { locale },
  );
}

function makeupSnapshot(): DraftSnapshotDTO {
  const dto = snapshot();
  const later = { ...dto.picks[0], pick_id: 'p5', slot_id: 'slot-5', pick_number: 5, round: 3, player_id: MISTY };
  return { ...dto, active_slot: dto.active_slot && { ...dto.active_slot, kind: 'makeup', round: 2 }, picks: [...dto.picks, later] };
}

describe('ClockBar round progress', () => {
  it('shows the round, the pick in the round, the seat track and the overall pick', () => {
    const html = clockBar(snapshot());
    expect(html).toContain('Round 2 of 9 · Pick 1 of 2');
    expect(html).toContain('Pick 3 of 18');
    expect(html).toContain('aria-label="Round 2: 0 of 2 picks made"');
  });

  it('names the player on the clock in a pill when it is not the viewer', () => {
    const dto = snapshot();
    const html = clockBar({ ...dto, viewer: { ...dto.viewer, player_id: MISTY } });
    expect(html).toContain('Dawn');
    expect(html).not.toContain('Round 2: 1 of 2');
  });

  it('labels a make-up pick with the round it makes up', () => {
    const html = clockBar(makeupSnapshot());
    expect(html).toContain('Round 3 of 9');
    expect(html).toContain('Make-up pick (round 2)');
  });

  it('reads a complete pool as complete with the tokens link, and a cancelled one (status twin complete) as cancelled without it', () => {
    const dto = snapshot();
    const ended = (phase: 'complete' | 'cancelled') =>
      renderWithI18n(
        <ClockBar
          vm={toDraftViewModel({ ...dto, active_slot: null, pool: { ...dto.pool, status: 'complete', phase } })}
          clock={null}
          notify={NOTIFY_UNSUPPORTED}
          onNotifyToggle={noop}
          onExtension={noop}
          onOpenPlayers={noop}
          tokensHref="/leagues/l1/tokens"
        />,
      );
    const done = ended('complete');
    expect(done).toContain('Draft complete');
    expect(done).toContain('Go to your tokens');
    const cancelled = ended('cancelled');
    expect(cancelled).toContain('Draft cancelled');
    expect(cancelled).not.toContain('Draft complete');
    expect(cancelled).not.toContain('Go to your tokens');
    expect(clockBar({ ...dto, active_slot: null, pool: { ...dto.pool, status: 'complete', phase: 'cancelled' } }, 'de')).toContain(
      'Draft abgebrochen',
    );
  });

  it('speaks German', () => {
    expect(clockBar(snapshot(), 'de')).toContain('Runde 2 von 9 · Pick 1 von 2');
    expect(clockBar(makeupSnapshot(), 'de')).toContain('Nachhol-Pick (Runde 2)');
  });
});

describe('UpcomingOrderStrip with the active slot', () => {
  const vm = toDraftViewModel(snapshot());

  it('opens with the "On the clock" chip, then "Up next", and labels round breaks', () => {
    const html = renderWithI18n(<UpcomingOrderStrip items={vm.upcoming} activeSlot={vm.activeSlot} makeupSeconds={150} />);
    expect(html).toContain('aria-label="On the clock, pick 3: Dawn"');
    expect(html.indexOf('On the clock')).toBeLessThan(html.indexOf('Up next'));
    expect(html).toContain('>R3<');
    expect(html).toContain('Make-up');
  });

  it('marks an active make-up slot as such', () => {
    const makeup = toDraftViewModel(makeupSnapshot());
    const html = renderWithI18n(<UpcomingOrderStrip items={makeup.upcoming} activeSlot={makeup.activeSlot} />);
    expect(html).toContain('aria-label="On the clock, make-up pick 3: Dawn"');
  });

  it('leaves the "On the clock" chip out where the clock bar names the player itself', () => {
    const html = renderWithI18n(<UpcomingOrderStrip items={vm.upcoming} activeSlot={vm.activeSlot} showNow={false} />);
    expect(html).not.toContain('On the clock');
    expect(html).not.toContain('Up next');
  });

  it('renders the active chip alone when nothing is queued', () => {
    const html = renderWithI18n(<UpcomingOrderStrip items={[]} activeSlot={vm.activeSlot} />);
    expect(html).toContain('On the clock');
    expect(html).not.toContain('Up next');
  });

  it('speaks German', () => {
    const html = renderWithI18n(<UpcomingOrderStrip items={vm.upcoming} activeSlot={vm.activeSlot} />, { locale: 'de' });
    expect(html).toContain('aria-label="Am Zug, Pick 3: Dawn"');
    expect(html).toContain('Als Nächstes');
    expect(html).toContain('Nachhol-Pick');
  });

  it('shows "You" on the viewer\'s own active chip', () => {
    expect(vm.activeSlot?.player_id).toBe(DAWN);
    const html = renderWithI18n(<UpcomingOrderStrip items={vm.upcoming} activeSlot={vm.activeSlot} />);
    expect(html).toMatch(/>You</);
  });
});
