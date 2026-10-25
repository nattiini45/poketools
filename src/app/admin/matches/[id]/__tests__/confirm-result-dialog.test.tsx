/**
 * The body of the Complete / Dispute confirmation. Radix portals render
 * nothing in static markup, so the body is tested apart from the Modal.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { computeSeriesTally } from '@/lib/match/series-tally';
import { ConfirmResultBody, resultWarnings } from '../ConfirmResultDialog';

const P1 = { id: 'p1', name: 'Ash' };
const P2 = { id: 'p2', name: 'Gary' };
const won = (id: string | null) => ({ winner_id: id });

function body(
  kind: 'completed' | 'disputed',
  winnerId: string,
  games: Array<{ winner_id: string | null }>,
  bestOf: number | null = 3,
  note = '',
) {
  return (
    <ConfirmResultBody
      kind={kind}
      player1={P1}
      player2={P2}
      winnerId={winnerId}
      tally={computeSeriesTally(games, P1.id, P2.id, bestOf)}
      note={note}
      acknowledged={false}
      onAcknowledgedChange={() => {}}
    />
  );
}

describe('ConfirmResultBody: complete', () => {
  it('shows the winner, tally, best-of and effects in English', () => {
    const html = renderToStaticMarkup(body('completed', P1.id, [won(P1.id), won(P1.id)], 3, 'Resolved'));
    expect(html).toContain('Ash will be recorded as the winner.');
    expect(html).toContain('Ash 2 – 0 Gary from 2 games');
    expect(html).toContain('Best of 3: first to 2');
    expect(html).toContain('ratings and standings');
    expect(html).toContain('Your note: Resolved');
  });

  it('shows the same in German', () => {
    const html = renderWithI18n(body('completed', P1.id, [won(P1.id), won(P1.id)]), { locale: 'de' });
    expect(html).toContain('Ash wird als Sieger eingetragen.');
    expect(html).toContain('Ash 2 – 0 Gary aus 2 Partien');
    expect(html).toContain('Best of 3: wer zuerst 2 gewinnt');
    expect(html).toContain('Ratings und Tabelle');
  });

  it('has no warning block or checkbox for a consistent 2-0', () => {
    const html = renderToStaticMarkup(body('completed', P1.id, [won(P1.id), won(P1.id)]));
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('role="alert"');
  });

  it('warns about a winner the games contradict and asks to acknowledge', () => {
    const html = renderToStaticMarkup(body('completed', P2.id, [won(P1.id), won(P1.id)]));
    expect(html).toContain('The recorded games favour Ash, but you are completing the match for Gary.');
    expect(html).toContain('I understand this does not match the recorded games.');
    expect(html).toContain('type="checkbox"');
  });

  it('warns about a match without games, in German', () => {
    const html = renderWithI18n(body('completed', P1.id, []), { locale: 'de' });
    expect(html).toContain('Noch keine Partien eingetragen');
    expect(html).toContain('Für dieses Spiel sind keine Partien eingetragen.');
    expect(html).toContain('type="checkbox"');
  });

  it('warns when the recorded games stay below the best-of threshold', () => {
    const html = renderToStaticMarkup(body('completed', P1.id, [won(P1.id)]));
    expect(html).toContain('Best of 3 needs 2 game wins, and the recorded games do not reach that yet.');
  });

  it('omits the best-of line when the best-of is unknown', () => {
    const html = renderToStaticMarkup(body('completed', P1.id, [won(P1.id)], null));
    expect(html).not.toContain('Best of');
  });
});

describe('ConfirmResultBody: dispute', () => {
  it('shows the reported winner and effects without a checkbox', () => {
    const html = renderToStaticMarkup(body('disputed', P2.id, [won(P1.id)]));
    expect(html).toContain('Reported winner: Gary');
    expect(html).toContain('a dispute notice is posted to Discord');
    expect(html).not.toContain('type="checkbox"');
  });

  it('says so when no winner is reported yet, in German', () => {
    const html = renderWithI18n(body('disputed', '', []), { locale: 'de' });
    expect(html).toContain('Es ist noch kein Sieger eingetragen.');
    expect(html).not.toContain('type="checkbox"');
  });
});

describe('resultWarnings', () => {
  it('never warns for a dispute', () => {
    expect(resultWarnings('disputed', computeSeriesTally([], P1.id, P2.id, 3), P1.id)).toEqual([]);
  });
});
