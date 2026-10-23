/**
 * PickSelector.
 * Tests run in node with static markup, so the Radix dialogs are replaced by
 * inline stand-ins: `Modal` renders its children, and `ArmedConfirmDialog`
 * records the props PickSelector hands it.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { ArmedConfirmDialogProps } from '@/components/draft-tool/shared/ArmedConfirmDialog';
import type { DraftPoolEntry } from '@/types/draft-pool';
import type { EvolutionTier } from '@/types/evolution';

const confirmProps: ArmedConfirmDialogProps[] = [];

vi.mock('@/components/ui/Modal', () => ({
  default: ({ title, children }: { title?: string; children: ReactNode }) => (
    <div data-modal-title={title}>{children}</div>
  ),
}));

vi.mock('@/components/draft-tool/shared/ArmedConfirmDialog', () => ({
  default: (props: ArmedConfirmDialogProps) => {
    confirmProps.push(props);
    return <div data-armed-confirm={props.open ? 'open' : 'closed'} />;
  },
}));

const { default: PickSelector, AuctionBidField } = await import('../PickSelector');

function poolEntry(name: string, stage3: string | null, cost: number | null): DraftPoolEntry {
  return {
    id: `entry-${name}`,
    season_id: 'season-1',
    pokemon_name: name,
    stage3_pokemon: stage3,
    point_cost: cost,
    power_tier: null,
    created_at: '2026-10-01T00:00:00.000Z',
  };
}

const entries = [poolEntry('Charmander', 'Charizard', 12), poolEntry('Bulbasaur', 'Venusaur', 30)];

function picker(extra: Partial<Parameters<typeof PickSelector>[0]> = {}) {
  return (
    <PickSelector
      takenPokemon={new Set()}
      draftType="budget"
      remainingBudget={25}
      onPick={() => {}}
      onClose={() => {}}
      poolEntries={entries}
      isEpb
      {...extra}
    />
  );
}

beforeEach(() => {
  confirmProps.length = 0;
});

describe('PickSelector confirmation', () => {
  it('never commits from the list: the pick goes through the armed confirm dialog, closed at first', () => {
    const html = renderToStaticMarkup(picker());
    expect(html).toContain('data-armed-confirm="closed"');
    expect(confirmProps).toHaveLength(1);
    const props = confirmProps[0];
    expect(props.open).toBe(false);
    // The default arming delay applies (CONFIRM_ARM_MS); PickSelector never shortens it.
    expect(props.armMs).toBeUndefined();
    expect(props.confirmLabel).toBe('Draft');
  });

  it('keeps the footer button disabled until a line is selected', () => {
    const html = renderToStaticMarkup(picker());
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm Pick<\/button>/);
  });

  it('marks lines above the remaining budget as over budget', () => {
    const html = renderToStaticMarkup(picker());
    expect(html).toContain('Over Budget');
    expect(html).toContain('12 pts');
  });
});

describe('PickSelector i18n', () => {
  it('renders German copy and German line labels', () => {
    const html = renderWithI18n(picker(), { locale: 'de' });
    expect(html).toContain('data-modal-title="Pokémon auswählen"');
    expect(html).toContain('Glumanda → Glurak');
    expect(html).toContain('Über Budget');
    expect(html).toContain('Pick bestätigen');
    expect(confirmProps.at(-1)?.confirmLabel).toBe('Draften');
  });

  it('keeps Pokémon names English with "keep Pokémon terms in English"', () => {
    const html = renderWithI18n(picker(), { locale: 'de', dataLocale: 'en' });
    expect(html).toContain('Charmander → Charizard');
    expect(html).toContain('Pokémon auswählen');
  });
});

describe('PickSelector legacy budget pools (fixed price)', () => {
  const legacyEntries = [poolEntry('Pikachu', null, 12), poolEntry('Mewtwo', null, 30)];

  it('lists each entry price and marks the ones above the remaining budget', () => {
    const html = renderToStaticMarkup(picker({ isEpb: false, poolEntries: legacyEntries }));
    expect(html).toContain('12 pts');
    expect(html).toContain('30 pts');
    expect(html).toContain('Over Budget');
  });

  it('an entry without a cost shows the pool default price, else 0 (what the server charges)', () => {
    const noCost = [poolEntry('Pikachu', null, null)];
    const withDefault = renderToStaticMarkup(picker({ isEpb: false, poolEntries: noCost, defaultPointCost: 9 }));
    expect(withDefault).toContain('9 pts');
    const without = renderToStaticMarkup(picker({ isEpb: false, poolEntries: noCost }));
    expect(without).toContain('0 pts');
  });

  it('an auction lists no fixed price but shows each line reserve before the pick', () => {
    const html = renderToStaticMarkup(
      picker({ isEpb: false, draftType: 'auction', poolEntries: legacyEntries, defaultPointCost: 9, remainingBudget: 40 }),
    );
    expect(html).not.toMatch(/>(\d+) pts</);
    expect(html).toContain('Minimum bid: 12 pts');
    expect(html).toContain('Minimum bid: 30 pts');
    expect(html).not.toContain('Over Budget');
    // The pool default is no reserve.
    expect(html).not.toContain('9 pts');
  });

  it('an auction line whose reserve exceeds the remaining budget is shown over budget and disabled', () => {
    const html = renderToStaticMarkup(
      picker({ isEpb: false, draftType: 'auction', poolEntries: legacyEntries, remainingBudget: 25 }),
    );
    expect(html).toContain('Minimum bid: 30 pts');
    expect(html.match(/Over Budget/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Mewtwo(?:(?!<\/button>).)*Over Budget/);
  });
});

describe('PickSelector evo-league pools with draft pool entries', () => {
  const tier = (base: string): EvolutionTier => ({
    id: `tier-${base}`,
    season_id: 'season-1',
    player_id: null,
    base_pokemon: base,
    stage2_pokemon: `${base}-2`,
    stage2_kos: 1,
    stage3_pokemon: null,
    stage3_kos: null,
    power_tier: 'A',
    created_at: '2026-10-01T00:00:00.000Z',
  });
  const evoTiers = [tier('Pikachu'), tier('Mewtwo')];
  const evoEntries = [poolEntry('Pikachu', null, 12), poolEntry('Mewtwo', null, 30)];

  it('budget: rows show the entry price the pick is charged, not the pool default', () => {
    const html = renderToStaticMarkup(
      picker({ isEpb: false, evoTiers, poolEntries: evoEntries, defaultPointCost: 3, remainingBudget: 25 }),
    );
    expect(html).toContain('12 pts');
    expect(html).toContain('30 pts');
    expect(html).not.toContain('3 pts');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Mewtwo(?:(?!<\/button>).)*Over Budget/);
  });

  it('auction: rows show the entry reserve and a reserve above the budget disables the row', () => {
    const html = renderToStaticMarkup(
      picker({ isEpb: false, draftType: 'auction', evoTiers, poolEntries: evoEntries, remainingBudget: 25 }),
    );
    expect(html).toContain('Minimum bid: 12 pts');
    expect(html).toContain('Minimum bid: 30 pts');
    expect(html.match(/Over Budget/g)).toHaveLength(1);
  });
});

describe('AuctionBidField (auction reserve)', () => {
  const field = (value: number, reserve = 12) => (
    <AuctionBidField value={value} reserve={reserve} remainingBudget={40} onChange={() => {}} />
  );

  it('the input min is the reserve, shown as a hint', () => {
    const html = renderToStaticMarkup(field(12));
    expect(html).toMatch(/<input[^>]*min="12"/);
    expect(html).toContain('Minimum bid: 12 pts');
    expect(html).not.toContain('aria-invalid');
  });

  it('marks a bid under the reserve as invalid', () => {
    const html = renderToStaticMarkup(field(5));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('text-poke-danger-ink');
  });

  it('renders the hint in German', () => {
    const html = renderWithI18n(field(12), { locale: 'de' });
    expect(html).toContain('Mindestgebot: 12 Pkt.');
  });

  it('marks a bid above the remaining budget as invalid, with a message', () => {
    const html = renderToStaticMarkup(field(41));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="pick-bid-min pick-bid-status"');
    expect(html).toContain('Your bid is more than your remaining budget of 40 pts.');
    expect(html).toMatch(/<input[^>]*max="40"/);
    const de = renderWithI18n(field(41), { locale: 'de' });
    expect(de).toContain('Dein Gebot ist höher als dein Restbudget von 40 Pkt.');
  });

  it('a bid within budget shows no over-budget message', () => {
    const html = renderToStaticMarkup(field(40));
    expect(html).not.toContain('pick-bid-over');
    expect(html).not.toContain('aria-invalid');
  });

  const status = (html: string) => html.match(/<span id="pick-bid-status"[^>]*>([^<]*)<\/span>/);

  it('announces the over-budget and below-reserve messages through an always-rendered polite live region', () => {
    const ok = renderToStaticMarkup(field(20));
    expect(ok).toMatch(/<span id="pick-bid-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*class="sr-only"/);
    expect(status(ok)?.[1]).toBe('');
    expect(status(renderToStaticMarkup(field(41)))?.[1]).toBe('Your bid is more than your remaining budget of 40 pts.');
    const below = renderToStaticMarkup(field(5));
    expect(status(below)?.[1]).toBe('Your bid is below the minimum bid of 12 pts.');
    expect(below).toContain('aria-describedby="pick-bid-min pick-bid-status"');
    expect(status(renderWithI18n(field(5), { locale: 'de' }))?.[1]).toBe('Dein Gebot liegt unter dem Mindestgebot von 12 Pkt.');
  });

  it('announces a non-whole bid as such, not as below the minimum bid', () => {
    const html = renderToStaticMarkup(field(12.5));
    expect(status(html)?.[1]).toBe('Your bid must be a whole number.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('data-testid="pick-bid-not-whole"');
    // The minimum-bid hint stays muted: 12.5 is not below 12.
    expect(html).toMatch(/<span id="pick-bid-min"[^>]*class="text-xs text-poke-text-muted"/);
    expect(status(renderWithI18n(field(12.5), { locale: 'de' }))?.[1]).toBe('Dein Gebot muss eine ganze Zahl sein.');
  });

  it('announces every reason that applies: a non-whole bid over the budget', () => {
    expect(status(renderToStaticMarkup(field(40.5)))?.[1]).toBe(
      'Your bid must be a whole number. Your bid is more than your remaining budget of 40 pts.',
    );
    expect(status(renderWithI18n(field(40.5), { locale: 'de' }))?.[1]).toBe(
      'Dein Gebot muss eine ganze Zahl sein. Dein Gebot ist höher als dein Restbudget von 40 Pkt.',
    );
  });

  it('announces a bid both below the reserve and over the budget with both reasons', () => {
    const html = renderToStaticMarkup(
      <AuctionBidField value={28} reserve={30} remainingBudget={25} onChange={() => {}} />,
    );
    expect(status(html)?.[1]).toBe(
      'Your bid is below the minimum bid of 30 pts. Your bid is more than your remaining budget of 25 pts.',
    );
  });

  it('sets no max when the reserve exceeds the budget (no contradictory min/max)', () => {
    const html = renderToStaticMarkup(field(50, 50));
    expect(html).toMatch(/<input[^>]*min="50"/);
    expect(html).not.toMatch(/<input[^>]*max=/);
    expect(html).toContain('aria-invalid="true"');
  });
});
