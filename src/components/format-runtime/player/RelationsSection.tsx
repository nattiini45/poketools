'use client';

import { useT } from '@/i18n/client';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { PlayerRef, RelationLinkView, RelationView } from '@/lib/format-engine/runtime/view-types';
import { cn } from '@/lib/utils/cn';
import { FOCUS_TARGET, PLAYER_CARD, PlayerSection, TrainerTile } from './parts';
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

  const line = (key: string, name: string, text: string) => (
    <li key={key} className="flex items-center gap-2">
      <TrainerTile name={name} />
      <span>{text}</span>
    </li>
  );
  const CELL = 'px-3 py-2 text-fg';

  return (
    <PlayerSection title={t('relations.heading')} icon="exp-share">
      <div className="flex flex-col gap-4">
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
            <div key={relation.key} className={PLAYER_CARD} data-relation={relation.key}>
              <h3 className="text-subtitle font-[550] text-fg">{label}</h3>
              {mine.length === 0 && open.length === 0 && <p className="text-body text-fg-muted">{t('relations.empty')}</p>}
              {!directed && others.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-body font-[550] text-fg">
                  {others.map((other) => line(`other-${other.id}`, nameOf(other), t(symmetric ? 'relations.partner' : 'relations.linked', { name: nameOf(other) })))}
                </ul>
              )}
              {directed && mine.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-body font-[550] text-fg">
                  {mine.map((link, index) => {
                    if (link.from?.id === viewerId && link.to !== null) {
                      return line(`give-${link.to.id}-${index}`, nameOf(link.to), t('relations.give', { name: nameOf(link.to) }));
                    }
                    if (link.to?.id === viewerId && link.from !== null) {
                      return line(`receive-${link.from.id}-${index}`, nameOf(link.from), t('relations.receive', { name: nameOf(link.from) }));
                    }
                    return null;
                  })}
                </ul>
              )}
              {hidden && <p className="text-body text-fg-muted">{t('relations.hiddenNotice')}</p>}
              {open.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <h4 className="text-caption font-[550] text-fg-muted">{t('relations.revealedHeading')}</h4>
                  {/* A scroll box without a focusable child is not in the tab order: the region role, name and tabIndex make it reachable. */}
                  <div
                    role="region"
                    aria-label={`${label}: ${t('relations.revealedHeading')}`}
                    tabIndex={0}
                    className={cn('overflow-x-auto rounded-poke-md border border-hairline', FOCUS_TARGET)}
                  >
                    <table className="w-full text-left text-body">
                      <caption className="sr-only">{`${label}: ${t('relations.revealedHeading')}`}</caption>
                      <thead className="bg-elevated text-caption text-fg-muted">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-[550]">
                            {symmetric ? t('relations.player') : t('relations.from')}
                          </th>
                          <th scope="col" className="px-3 py-2 font-[550]">
                            {symmetric ? t('relations.partnerColumn') : t('relations.to')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {open.map((link) => (
                          <tr key={`${link.from.id}-${link.to.id}`}>
                            <td className={CELL}>{nameOf(link.from)}</td>
                            <td className={CELL}>{nameOf(link.to)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PlayerSection>
  );
}
