import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { draftTokensMessages } from '@/i18n/messages/draft/tokens';
import { createTranslator, getMessages } from '@/i18n/core';
import { formatPack } from '@/lib/format-pack';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import type { LineId, TokenOverviewDTO, TokenRefusalCode } from '@/types/draft-queue';
import ComebackTokenCard from '../ComebackTokenCard';
import CosmoTokenCard from '../CosmoTokenCard';
import DraftKillTokenCard from '../DraftKillTokenCard';
import ProgressSourcesTable from '../ProgressSourcesTable';
import TokenCenter from '../TokenCenter';

const CHAR = 'charmander--charizard' as LineId;
/** A participation-token line (stored flag `cosmog`); its text comes from the active format pack. */
const PARTICIPATION = 'dratini--dragonite' as LineId;
const PACK_EN = formatPack.messages.en;
const GASTLY = 'gastly--gengar' as LineId;

function entry(lineId: LineId, names: string[], cumulative: [number, number | null]): DraftLineCatalogEntry {
  return {
    lineId,
    entryId: `e-${lineId}`,
    lineNumber: 1,
    price: 20,
    stages: names.map((name, i) => ({ stage: (i + 1) as 1 | 2 | 3, name, speciesId: name.toLowerCase() })),
    thresholds: { toStage2: cumulative[0], additionalToStage3: cumulative[1], cumulative },
    flags: { cosmog: lineId === PARTICIPATION, noRedraft: false, scatterbugCocoon: false },
    specialRules: null,
    branch: { groupKey: names[0].toLowerCase(), count: 1 },
  };
}

const CATALOG: DraftLineCatalog = {
  listVersionId: 'list-1',
  bannedMoves: [],
  lines: [
    entry(CHAR, ['Charmander', 'Charmeleon', 'Charizard'], [3, 7]),
    entry(PARTICIPATION, ['Dratini', 'Dragonair', 'Dragonite'], [5, 10]),
    entry(GASTLY, ['Gastly', 'Haunter', 'Gengar'], [3, 7]),
  ],
};

type DraftKill = TokenOverviewDTO['draft_kill'];

function draftKill(overrides: Partial<DraftKill> = {}): DraftKill {
  return {
    window: 'open',
    cutoff_at: '2026-10-20T18:00:00.000Z',
    cost: 5,
    max: 1,
    owned: 0,
    unspent_points: 7,
    lines: [
      { line_id: CHAR, has_token: false, progress: 2, next_threshold: 3, eligible: false, reason: 'TOKEN_WOULD_EVOLVE' },
      { line_id: GASTLY, has_token: false, progress: 0, next_threshold: 3, eligible: true, reason: null },
      { line_id: PARTICIPATION, has_token: true, progress: 4, next_threshold: 5, eligible: false, reason: 'TOKEN_LINE_LIMIT' },
    ],
    ...overrides,
  };
}

function lines(): TokenOverviewDTO['lines'] {
  return [
    {
      line_id: CHAR,
      stage: 1,
      self_earned_kills: 1,
      transferred_evo_progress: 1,
      draft_token_progress: 0,
      comeback_token_progress: 0,
      cosmo_token_progress: 0,
      total_progress: 2,
      next_threshold: 3,
    },
    {
      line_id: PARTICIPATION,
      stage: 1,
      self_earned_kills: 0,
      transferred_evo_progress: 0,
      draft_token_progress: 1,
      comeback_token_progress: 0,
      cosmo_token_progress: 3,
      total_progress: 4,
      next_threshold: 5,
    },
  ];
}

const comeback = (overrides: Partial<TokenOverviewDTO['comeback']> = {}): TokenOverviewDTO['comeback'] => ({
  earned: 2,
  spent: 0,
  unspent: 2,
  history: [
    { matchday: 2, score: '0:4', tokens: 1 },
    { matchday: 5, score: '0:6', tokens: 1 },
  ],
  spend_open: true,
  ...overrides,
});

const noop = vi.fn(async () => null);

/** Every `TokenRefusalCode` (compile-time exhaustive). */
const REFUSALS: Record<TokenRefusalCode, true> = {
  TOKEN_WOULD_EVOLVE: true,
  TOKEN_LINE_LIMIT: true,
  TOKEN_PLAYER_LIMIT: true,
  TOKEN_POINTS_SHORT: true,
  LINE_FULLY_EVOLVED: true,
  TOKEN_WINDOW_CLOSED: true,
};

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('draft/tokens messages', () => {
  it('has an EN and DE text for every refusal code, with its DTO params filled', () => {
    for (const locale of ['en', 'de'] as const) {
      const t = createTranslator(draftTokensMessages, locale);
      const params = { progress: 2, next: 3, max: 1, cost: 5, unspent: 1 };
      for (const code of Object.keys(REFUSALS) as TokenRefusalCode[]) {
        const out = t(`reason.${code}`, params);
        expect(out).not.toMatch(/\{|reason\./);
      }
    }
  });

  it('never says a bare "Kill Token"', () => {
    for (const locale of ['en', 'de'] as const) {
      const json = JSON.stringify(getMessages(draftTokensMessages, locale));
      expect(json).not.toMatch(/(?<!Draft[ -])Kill[ -]?Token/);
    }
  });
});

describe('DraftKillTokenCard', () => {
  it('explains why a line cannot get a token: it would trigger the evolution (EN)', () => {
    const html = plain(renderWithI18n(<DraftKillTokenCard data={draftKill()} catalog={CATALOG} readOnly={false} onBuy={noop} />));
    expect(html).toContain('Draft Kill Token');
    expect(html).toContain('Cannot be used: it would trigger the evolution (progress 2, next at 3).');
    expect(html).toContain('0/1 owned');
    expect(html).toContain('Unspent points: 7 P');
    expect(html).toContain('Token used');
    expect(html).toContain('Buy for 5 P');
    expect(html).toContain('Available until');
    expect(html).not.toMatch(/(?<!Draft )Kill Token/);
  });

  it('renders the refusal in German', () => {
    const html = plain(
      renderWithI18n(<DraftKillTokenCard data={draftKill()} catalog={CATALOG} readOnly={false} onBuy={noop} />, { locale: 'de' }),
    );
    expect(html).toContain('Draft-Kill-Token');
    expect(html).toContain('Nicht einsetzbar: Das würde die Entwicklung auslösen (Fortschritt 2, nächste bei 3).');
    expect(html).toContain('Für 5 P kaufen');
    expect(html).toContain('Verfügbar bis');
  });

  it('renders every line-level refusal from the DTO', () => {
    const codes: TokenRefusalCode[] = ['TOKEN_LINE_LIMIT', 'TOKEN_POINTS_SHORT', 'LINE_FULLY_EVOLVED', 'TOKEN_WOULD_EVOLVE'];
    const data = draftKill({
      lines: codes.map((reason, i) => ({
        line_id: `l${i}--x` as LineId,
        has_token: false,
        progress: 2,
        next_threshold: 3,
        eligible: false,
        reason,
      })),
    });
    const html = renderWithI18n(<DraftKillTokenCard data={data} catalog={CATALOG} readOnly={false} onBuy={noop} />);
    for (const code of codes) expect(html).toContain(`data-reason="${code}"`);
    expect(plain(html)).toContain('Needs 5 unspent points (you have 7).');
  });

  it('shows the window states and the player limit once on the card', () => {
    const before = plain(renderWithI18n(<DraftKillTokenCard data={draftKill({ window: 'before' })} catalog={CATALOG} readOnly={false} onBuy={noop} />));
    expect(before).toContain('Available once the Initial draft is complete.');
    expect(before).not.toContain('Buy for');

    const closed = plain(renderWithI18n(<DraftKillTokenCard data={draftKill({ window: 'closed' })} catalog={CATALOG} readOnly={false} onBuy={noop} />));
    expect(closed).toContain('The purchase window is closed.');

    const untilResult = plain(renderWithI18n(<DraftKillTokenCard data={draftKill({ cutoff_at: null })} catalog={CATALOG} readOnly={false} onBuy={noop} />));
    expect(untilResult).toContain('Available until the first match result is confirmed.');

    const limit = plain(renderWithI18n(<DraftKillTokenCard data={draftKill({ owned: 1 })} catalog={CATALOG} readOnly={false} onBuy={noop} />));
    expect(limit).toContain('Maximum of 1 per player reached.');
  });

  it('the read-only admin view has no buy buttons', () => {
    const html = plain(renderWithI18n(<DraftKillTokenCard data={draftKill()} catalog={CATALOG} readOnly onBuy={noop} />));
    expect(html).not.toContain('Buy for');
  });
});

describe('ComebackTokenCard', () => {
  it('shows balance and history, and is locked before the Redraft', () => {
    const html = plain(
      renderWithI18n(
        <ComebackTokenCard data={comeback({ spend_open: false })} lines={lines()} catalog={CATALOG} readOnly={false} onSpend={noop} />,
      ),
    );
    expect(html).toContain('Comeback Token');
    expect(html).toContain('Comeback Tokens can be spent after the Redraft.');
    expect(html).toContain('0:6');
    expect(html).toContain('+1');
    expect(html).not.toContain('Spend on your lines');
  });

  it('when open: a stepper per line that is not fully evolved, with the progress preview', () => {
    const html = plain(
      renderWithI18n(<ComebackTokenCard data={comeback()} lines={lines()} catalog={CATALOG} readOnly={false} onSpend={noop} />),
    );
    expect(html).toContain('Spend on your lines');
    expect(html).toContain('Progress 2 → 2/3');
    expect(html).toContain('Progress 4 → 4/5');
    expect(html).toContain('2 tokens left to assign');
  });

  it('German stepper texts', () => {
    const html = plain(
      renderWithI18n(<ComebackTokenCard data={comeback()} lines={lines()} catalog={CATALOG} readOnly={false} onSpend={noop} />, {
        locale: 'de',
      }),
    );
    expect(html).toContain('Comeback-Token');
    expect(html).toContain('Auf deine Linien verteilen');
    expect(html).toContain('Noch 2 Tokens zu verteilen');
  });

  it('nothing to spend / read only', () => {
    const empty = plain(
      renderWithI18n(<ComebackTokenCard data={comeback({ unspent: 0 })} lines={lines()} catalog={CATALOG} readOnly={false} onSpend={noop} />),
    );
    expect(empty).toContain('You have no unspent Comeback Tokens.');
    const ro = plain(renderWithI18n(<ComebackTokenCard data={comeback()} lines={lines()} catalog={CATALOG} readOnly onSpend={noop} />));
    expect(ro).not.toContain('Spend on your lines');
  });
});

describe('CosmoTokenCard and ProgressSourcesTable', () => {
  it('participation tokens: tokens, matchdays, catalog thresholds and the note', () => {
    const cosmoLine = lines()[1];
    const html = plain(
      renderWithI18n(
        <CosmoTokenCard data={{ line_id: PARTICIPATION, tokens: 3, matchdays_brought: [4, 1, 2] }} line={cosmoLine} catalog={CATALOG} />,
      ),
    );
    expect(html).toContain(PACK_EN.glossary.tokenCount.cosmo.other.replace('{count}', '3'));
    expect(html).toMatch(/Brought on matchdays 1, 2,? and 4/);
    expect(html).toContain('Progress 4/5');
    expect(html).toContain('Evolves at 5 and 10');
    expect(html).toContain(PACK_EN.draftTokens.cosmo.note);
  });

  it('the table labels only self-earned kills as KOs and shows each source', () => {
    const en = plain(renderWithI18n(<ProgressSourcesTable lines={lines()} catalog={CATALOG} />));
    expect(en).toContain('KOs (self-earned)');
    expect(en).toContain('Draft Kill Token');
    expect(en).toContain('Comeback Token');
    expect(en).toContain(PACK_EN.glossary.token.cosmo);
    expect(en).toContain('2/3');
    const de = plain(renderWithI18n(<ProgressSourcesTable lines={lines()} catalog={CATALOG} />, { locale: 'de' }));
    expect(de).toContain('KOs (selbst erzielt)');
    expect(de).toContain('Fortschritt nach Quelle');
  });
});

describe('TokenCenter', () => {
  it('renders the loading state first, without a provider (English)', () => {
    const source = { overview: vi.fn(() => new Promise<never>(() => {})), buyDraftKill: vi.fn(), spendComeback: vi.fn() };
    const html = renderToStaticMarkup(<TokenCenter seasonId="s1" catalog={CATALOG} source={source} />);
    expect(html).toContain('Loading tokens…');
  });
});
