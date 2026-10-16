/**
 * EPB trade consent (T03): the player prompt and the admin list speak the
 * viewer's language (the `trades` namespace), never the world's. Rendered
 * through react-dom/server (vitest 'node' env); the router is a stub.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

import TradeConsentPrompt, { type PendingTradeView } from '../TradeConsentPrompt';
import AdminPendingTrades, { type AdminPendingTradeView } from '../AdminPendingTrades';
import { renderWithI18n } from '@/test/i18n';

function view(overrides: Partial<PendingTradeView> = {}): PendingTradeView {
  return {
    requestId: 'r1',
    role: 'a',
    yourLine: 'Charmander',
    receivedLine: 'Bulbasaur',
    partnerName: 'Misty',
    otherName: 'Misty',
    youConsented: false,
    otherConsented: false,
    ...overrides,
  };
}

const ADMIN_VIEW: AdminPendingTradeView = {
  requestId: 'r1',
  playerAName: 'Ash',
  playerBName: 'Misty',
  lineA: 'Charmander',
  lineB: 'Bulbasaur',
  consentA: true,
  consentB: false,
  createdAt: '2026-10-01T12:00:00Z',
};

/** The visible text: tags dropped, the two entities React escapes here decoded, whitespace collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,])/g, '$1')
    .trim();

describe('TradeConsentPrompt', () => {
  it('renders nothing without pending trades', () => {
    expect(renderWithI18n(<TradeConsentPrompt seasonId="s1" requests={[]} />, { locale: 'de' })).toBe('');
  });

  it('English: header, one proposal sentence with the lines in bold, waiting line and buttons', () => {
    const html = renderWithI18n(<TradeConsentPrompt seasonId="s1" requests={[view()]} />);
    expect(text(html)).toContain('Pending trade proposals awaiting your consent');
    expect(text(html)).toContain('Trade proposal: you give Charmander, you receive Bulbasaur from Misty.');
    expect(html).toContain('<strong>Charmander</strong>');
    expect(html).toContain('<strong>Bulbasaur</strong>');
    expect(html).toContain('<strong>Misty</strong>');
    expect(text(html)).toContain("Waiting for your consent and Misty's.");
    expect(text(html)).toContain('Consent to Trade');
    expect(text(html)).toContain('Decline');
  });

  it('German: the same prompt in du-form', () => {
    const html = renderWithI18n(<TradeConsentPrompt seasonId="s1" requests={[view()]} />, { locale: 'de' });
    expect(text(html)).toContain('Offene Handelsvorschläge, die auf deine Zustimmung warten');
    expect(text(html)).toContain('Handelsvorschlag: Du gibst Glumanda ab und erhältst Bisasam von Misty.');
    expect(html).toContain('<strong>Bisasam</strong>');
    expect(text(html)).toContain('Wartet auf deine Zustimmung und die von Misty.');
    expect(text(html)).toContain('Handel zustimmen');
    expect(text(html)).toContain('Ablehnen');
    expect(text(html)).not.toContain('Trade proposal');
  });

  it('shows the consent state lines and hides the buttons once the viewer consented', () => {
    const waiting = renderWithI18n(
      <TradeConsentPrompt seasonId="s1" requests={[view({ youConsented: true })]} />,
      { locale: 'de' },
    );
    expect(text(waiting)).toContain('Deine Zustimmung ist vermerkt – wir warten auf Misty.');
    expect(text(waiting)).not.toContain('Handel zustimmen');
    const both = renderWithI18n(
      <TradeConsentPrompt seasonId="s1" requests={[view({ youConsented: true, otherConsented: true })]} />,
    );
    expect(text(both)).toContain('Both sides consented.');
  });

  it('German UI with English Pokémon data names keeps the stored English line names', () => {
    const html = renderWithI18n(<TradeConsentPrompt seasonId="s1" requests={[view()]} />, {
      locale: 'de',
      dataLocale: 'en',
    });
    expect(text(html)).toContain('Handelsvorschlag: Du gibst Charmander ab und erhältst Bulbasaur von Misty.');
  });

  it('renders English without a provider (hooks never throw)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToStaticMarkup(<TradeConsentPrompt seasonId="s1" requests={[view()]} />);
    expect(text(html)).toContain('Pending trade proposals awaiting your consent');
    warn.mockRestore();
  });
});

describe('AdminPendingTrades', () => {
  it('English: intro, the trade with both sides, consent marks and cancel', () => {
    const html = renderWithI18n(<AdminPendingTrades seasonId="s1" requests={[ADMIN_VIEW]} />);
    expect(text(html)).toContain('Pending trades awaiting player consent. Either side or an admin may cancel.');
    expect(text(html)).toContain('Ash (Charmander) ↔ Misty (Bulbasaur)');
    expect(text(html)).toContain('A ✓');
    expect(text(html)).toContain('B ✗');
    expect(text(html)).toContain('Cancel');
  });

  it('German: intro, empty state and cancel', () => {
    const html = renderWithI18n(<AdminPendingTrades seasonId="s1" requests={[ADMIN_VIEW]} />, { locale: 'de' });
    expect(text(html)).toContain('Offene Handelsvorschläge, die auf die Zustimmung der Spieler warten.');
    expect(text(html)).toContain('Abbrechen');
    expect(text(html)).toContain('Ash (Glumanda) ↔ Misty (Bisasam)');
    const empty = renderWithI18n(<AdminPendingTrades seasonId="s1" requests={[]} />, { locale: 'de' });
    expect(text(empty)).toContain('Keine offenen Handelsvorschläge.');
    expect(text(renderWithI18n(<AdminPendingTrades seasonId="s1" requests={[]} />))).toContain('No pending trades.');
  });
});
