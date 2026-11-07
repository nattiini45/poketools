'use client';

import Section from '@/components/ui/Section';
import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { PlayerRef, RelationLinkView, RelationView } from '@/lib/format-engine/runtime/view-types';
import ScrollRegion from '../ScrollRegion';
import { useLText, usePlayerName } from './useLabels';

export interface RelationsSectionProps {
  relations: readonly RelationView[];
  /** The viewer's player id: the view fills it in on their own side of a link. */
  viewerId: string;
}

type OpenLink = RelationLinkView & { from: PlayerRef; to: PlayerRef };

/** A revealed link with both sides known: what a revealed relation shows to everyone. */
const isOpenLink = (link: RelationLinkView): link is OpenLink => link.revealed && link.from !== null && link.to !== null;

/**
 * The other end of each of the viewer's links, once per player. A `pairs` relation stores both directions of a pair,
 * so the same partner shows up twice; a `manual` link may be stored in one direction or both.
 */
function counterparts(mine: readonly RelationLinkView[], viewerId: string): PlayerRef[] {
  const seen = new Set<string>();
  const out: PlayerRef[] = [];
  for (const link of mine) {
    const other = link.from?.id === viewerId ? link.to : link.from;
    if (other === null || seen.has(other.id)) continue;
    seen.add(other.id);
    out.push(other);
  }
  return out;
}

/** A revealed `pairs` relation lists each pair once: the reverse direction of a pair already listed is dropped. */
function oncePerPair(open: readonly OpenLink[]): OpenLink[] {
  const seen = new Set<string>();
  return open.filter((link) => {
    const key = [link.from.id, link.to.id].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Who is linked to whom, as far as the viewer may see it. The wording follows the relation's shape: a `derangement`
 * is a gift chain ("You give to X", "Your giver: Y"), a `pairs` relation is symmetric ("Your partner: X", listed once
 * per pair) and a `manual` one is neutral ("Linked with X"). A hidden side renders nothing (the server sends `null`,
 * never an id), and a notice says the other side is still hidden. Once a relation is revealed its pairs are listed in a
 * table for everyone.
 */
export default function RelationsSection({ relations, viewerId }: RelationsSectionProps) {
  const t = useT(formatRuntimePlayerMessages);
  const labelOf = useLText();
  const nameOf = usePlayerName();

  return (
    <Section title={t('relations.heading')}>
      <div className="space-y-5">
        {relations.map((relation) => {
          const mine = relation.links.filter((link) => link.from?.id === viewerId || link.to?.id === viewerId);
          const symmetric = relation.shape === 'pairs';
          const directed = relation.shape === 'derangement';
          const open = symmetric ? oncePerPair(relation.links.filter(isOpenLink)) : relation.links.filter(isOpenLink);
          const others = directed ? [] : counterparts(mine, viewerId);
          // A partner is known from either direction of a pair, so "hidden" only applies when none of them is.
          const hidden =
            mine.some((link) => (link.from?.id === viewerId ? link.to === null : link.from === null)) && !(symmetric && others.length > 0);
          const label = labelOf(relation.label);
          return (
            <div key={relation.key} className="space-y-2" data-relation={relation.key}>
              <h3 className="font-heading text-base font-bold text-poke-text-primary">{label}</h3>
              {mine.length === 0 && open.length === 0 && <p className="text-sm text-poke-text-secondary">{t('relations.empty')}</p>}
              {!directed && others.length > 0 && (
                <ul className="space-y-0.5 text-sm text-poke-text-primary">
                  {others.map((other) => (
                    <li key={`other-${other.id}`}>{t(symmetric ? 'relations.partner' : 'relations.linked', { name: nameOf(other) })}</li>
                  ))}
                </ul>
              )}
              {directed && mine.length > 0 && (
                <ul className="space-y-0.5 text-sm text-poke-text-primary">
                  {mine.map((link, index) => {
                    if (link.from?.id === viewerId && link.to !== null) {
                      return <li key={`give-${link.to.id}-${index}`}>{t('relations.give', { name: nameOf(link.to) })}</li>;
                    }
                    if (link.to?.id === viewerId && link.from !== null) {
                      return <li key={`receive-${link.from.id}-${index}`}>{t('relations.receive', { name: nameOf(link.from) })}</li>;
                    }
                    return null;
                  })}
                </ul>
              )}
              {hidden && <p className="text-sm text-poke-text-secondary">{t('relations.hiddenNotice')}</p>}
              {open.length > 0 && (
                <div className="space-y-1">
                  <h4 className="font-heading text-sm font-semibold text-poke-text-secondary">{t('relations.revealedHeading')}</h4>
                  <ScrollRegion label={`${label}: ${t('relations.revealedHeading')}`}>
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">{`${label}: ${t('relations.revealedHeading')}`}</caption>
                      <thead className="bg-poke-elevated text-poke-text-secondary">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-heading font-semibold">
                            {symmetric ? t('relations.player') : t('relations.from')}
                          </th>
                          <th scope="col" className="px-3 py-2 font-heading font-semibold">
                            {symmetric ? t('relations.partnerColumn') : t('relations.to')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-poke-border">
                        {open.map((link) => (
                          <tr key={`${link.from.id}-${link.to.id}`}>
                            <td className="px-3 py-2 text-poke-text-primary">{nameOf(link.from)}</td>
                            <td className="px-3 py-2 text-poke-text-primary">{nameOf(link.to)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollRegion>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
