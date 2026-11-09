/** @vitest-environment jsdom */
/**
 * `RelationsSection`: the viewer's own links as sentences, only the sides the view sends (a `null` side renders
 * nothing, never an id), the public table of a revealed relation, and "former player" for a name the league lacks.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { RelationView } from '@/lib/format-engine/runtime/view-types';
import RelationsSection from '../RelationsSection';
import { ANNA, BEN, CARA, ME, relation } from './fixtures';

function setup(relations: RelationView[], locale: Locale = 'en') {
  const view = render(withI18n(<RelationsSection relations={relations} viewerId={ME} />, { locale }));
  return { view, t: createTranslator(formatRuntimePlayerMessages, locale) };
}

describe('RelationsSection', () => {
  it('says nothing has been drawn while the relation has no visible link', () => {
    const { t } = setup([relation()]);
    expect(screen.getByRole('heading', { name: 'Secret santa' })).toBeTruthy();
    expect(screen.getByText(t('relations.empty'))).toBeTruthy();
  });

  it('shows who the viewer gives to, and keeps the hidden giver out of the page', () => {
    const { view, t } = setup([
      relation({ links: [{ from: { id: ME, name: 'Me' }, to: { id: ANNA, name: 'Anna' }, revealed: false }, { from: null, to: { id: ME, name: 'Me' }, revealed: false }] }),
    ]);
    expect(screen.getByText(t('relations.give', { name: 'Anna' }))).toBeTruthy();
    // The viewer's receiving link has a hidden giver: no sentence, a notice instead, and no id anywhere.
    expect(screen.queryByText(/Your giver/)).toBeNull();
    expect(screen.getByText(t('relations.hiddenNotice'))).toBeTruthy();
    for (const id of [BEN, CARA]) expect(view.container.innerHTML).not.toContain(id);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the giver once the relation lets the viewer see that side', () => {
    const { t } = setup([relation({ links: [{ from: { id: BEN, name: 'Ben' }, to: { id: ME, name: 'Me' }, revealed: false }] })]);
    expect(screen.getByText(t('relations.receive', { name: 'Ben' }))).toBeTruthy();
  });

  it('lists every pair of a revealed relation in a table and writes "former player" for a missing name', () => {
    const { t } = setup([
      relation({
        links: [
          { from: { id: ME, name: 'Me' }, to: { id: ANNA, name: 'Anna' }, revealed: true },
          { from: { id: BEN, name: 'Ben' }, to: { id: CARA, name: null }, revealed: true },
        ],
      }),
    ]);
    const table = screen.getByRole('table', { name: /Secret santa/ });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(['MeAnna', `Ben${t('player.former')}`]);
    expect(screen.getByText(t('relations.give', { name: 'Anna' }))).toBeTruthy();
  });

  it('never prints a pair with a hidden side in the revealed table', () => {
    setup([relation({ links: [{ from: { id: BEN, name: 'Ben' }, to: null, revealed: true }] })]);
    expect(screen.queryByRole('table')).toBeNull();
  });

  describe('by shape', () => {
    const pairLinks = [
      { from: { id: ME, name: 'Me' }, to: { id: ANNA, name: 'Anna' }, revealed: true },
      { from: { id: ANNA, name: 'Anna' }, to: { id: ME, name: 'Me' }, revealed: true },
      { from: { id: BEN, name: 'Ben' }, to: { id: CARA, name: 'Cara' }, revealed: true },
      { from: { id: CARA, name: 'Cara' }, to: { id: BEN, name: 'Ben' }, revealed: true },
    ];

    it('a revealed pairs relation says "partner" once and lists each pair once, never the gift wording', () => {
      const { t } = setup([relation({ shape: 'pairs', links: pairLinks })]);
      expect(screen.getAllByText(t('relations.partner', { name: 'Anna' }))).toHaveLength(1);
      expect(screen.queryByText(/You give to/)).toBeNull();
      expect(screen.queryByText(/Your giver/)).toBeNull();
      const rows = within(screen.getByRole('table', { name: /Secret santa/ })).getAllByRole('row');
      expect(rows.map((row) => row.textContent)).toEqual([`${t('relations.player')}${t('relations.partnerColumn')}`, 'MeAnna', 'BenCara']);
    });

    it('an unrevealed pairs relation shows the partner from either direction and no hidden notice', () => {
      const { t } = setup([
        relation({ shape: 'pairs', links: [{ from: { id: ME, name: 'Me' }, to: { id: ANNA, name: 'Anna' }, revealed: false }, { from: null, to: { id: ME, name: 'Me' }, revealed: false }] }),
      ]);
      expect(screen.getByText(t('relations.partner', { name: 'Anna' }))).toBeTruthy();
      expect(screen.queryByText(t('relations.hiddenNotice'))).toBeNull();
    });

    it('a pairs relation whose partner is hidden shows only the notice', () => {
      const { t } = setup([relation({ shape: 'pairs', links: [{ from: null, to: { id: ME, name: 'Me' }, revealed: false }] })]);
      expect(screen.queryByText(/Your partner/)).toBeNull();
      expect(screen.getByText(t('relations.hiddenNotice'))).toBeTruthy();
    });

    it('a manual relation uses neutral wording and keeps the from/to table', () => {
      const { t } = setup([
        relation({ shape: 'manual', links: [{ from: { id: ME, name: 'Me' }, to: { id: ANNA, name: 'Anna' }, revealed: true }, { from: { id: ANNA, name: 'Anna' }, to: { id: ME, name: 'Me' }, revealed: true }] }),
      ]);
      expect(screen.getAllByText(t('relations.linked', { name: 'Anna' }))).toHaveLength(1);
      expect(screen.queryByText(/You give to/)).toBeNull();
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
    });

    it('the German partner sentence', () => {
      setup([relation({ shape: 'pairs', links: pairLinks })], 'de');
      expect(screen.getByText('Dein Partner: Anna')).toBeTruthy();
    });
  });

  it('puts the revealed table in a focusable, named scroll region', () => {
    setup([relation({ links: [{ from: { id: ME, name: 'Me' }, to: { id: ANNA, name: 'Anna' }, revealed: true }] })]);
    const region = screen.getByRole('region', { name: /Secret santa/ });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(within(region).getByRole('table')).toBeTruthy();
  });

  it('renders in German', () => {
    setup([relation({ links: [{ from: { id: ME, name: 'Me' }, to: { id: ANNA, name: 'Anna' }, revealed: false }] })], 'de');
    expect(screen.getByRole('heading', { name: 'Zuordnungen' })).toBeTruthy();
    expect(screen.getByText('Du beschenkst Anna')).toBeTruthy();
  });
});
