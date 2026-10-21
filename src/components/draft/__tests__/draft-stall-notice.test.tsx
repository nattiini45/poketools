/**
 * DraftStallNotice: a fixed-price draft in turn order whose current picker can afford nothing that completes their
 * roster. The stuck player reads it in the second person, everyone else by name; only admins get the switch to free
 * order. English and German.
 * (Static markup escapes the apostrophe as `&#x27;`.)
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import DraftStallNotice from '../DraftStallNotice';

const stall = { player_id: 'p1', remaining: 40, open_slots: 2, min_cost: 55 };
const notice = (viewer: string, isAdmin: boolean, s = stall) => (
  <DraftStallNotice stall={s} name="Misty" currentPlayerId={viewer} isAdmin={isAdmin} onSwitch={() => {}} />
);

describe('DraftStallNotice', () => {
  it('tells the stuck player in the second person, without the admin switch', () => {
    const html = renderWithI18n(notice('p1', false));
    expect(html).toContain("You can&#x27;t make a pick: you have 40 points, but your 2 open picks cost at least 55 together.");
    expect(html).toContain('An admin can switch the draft to free order so it can go on.');
    expect(html).not.toContain('Misty');
    expect(html).not.toContain('<button');
  });

  it('tells everyone else by name; admins get the switch', () => {
    const html = renderWithI18n(notice('p2', true));
    expect(html).toContain("Misty can&#x27;t make a pick: they have 40 points, but their 2 open picks cost at least 55 together.");
    expect(html).toContain('Switch to free order');
    expect(html).toContain('<button');
  });

  it('the last open pick reads as the cheapest Pokémon left', () => {
    const html = renderWithI18n(notice('p1', false, { ...stall, open_slots: 1, min_cost: 50 }));
    expect(html).toContain('you have 40 points, but the cheapest Pokémon left costs 50.');
  });

  it('renders German', () => {
    const self = renderWithI18n(notice('p1', false), { locale: 'de' });
    expect(self).toContain('Du kannst gerade nicht picken: Du hast 40 Punkte, deine 2 offenen Picks kosten zusammen aber mindestens 55.');
    const admin = renderWithI18n(notice('p2', true), { locale: 'de' });
    expect(admin).toContain('Misty kann gerade nicht picken: 40 Punkte übrig');
    expect(admin).toContain('Auf freie Reihenfolge umstellen');
  });
});
