'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useLocale, useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import { applyAdjustmentRequest, unmaskRelationsRequest } from '@/lib/format-engine/runtime/client-api-admin';
import type { AdminActionView, AdminRelationView, AdminUnmasked, PlayerRef } from '@/lib/format-engine/runtime/view-types';
import { BUTTON_TOUCH, labelText } from './admin-shared';
import ScrollRegion from '../ScrollRegion';
import ReasonDialog from './ReasonDialog';
import { useAdminRequest } from './useAdminRequest';
import { useStatusFocus } from './useStatusFocus';

export interface RelationsAdminProps {
  seasonId: string;
  /** Masked, as an ordinary player sees them. */
  relations: readonly AdminRelationView[];
  /** The labels of the actions the unmasked states are listed under. */
  actions: readonly Pick<AdminActionView, 'id' | 'label'>[];
  /** The format allows `relation` adjustments: a relation with links can be revealed, one without can be drawn. */
  canReveal: boolean;
  /**
   * Everyone the server draws over (the players of every phase of the league, as `rosterOf` reads them). A draw cannot be
   * redone, so the draw dialog lists them with their count and asks for that count to be typed; a name of `null` is a
   * former player.
   */
  roster: readonly PlayerRef[];
}

/** Every link is visible with its `revealed` flag set: the relation is already public. */
function isRevealed(relation: AdminRelationView): boolean {
  return relation.link_count > 0 && relation.links.length === relation.link_count && relation.links.every((link) => link.revealed);
}

/**
 * The relations of the format (Secret Santa, a ladder pairing, ...) as an ordinary player sees them: masked. "Show hidden
 * sides" is an explicit, audited read (the admin may also play, and the sides stay hidden from the players), after which
 * the unmasked links and the state and target of each player's submission per action are listed in this island. Reveal
 * records a `relation` adjustment that makes both sides of every link public. Draw records the `relation` adjustment that
 * makes the links of a relation that has none (the Secret Santa): the server draws them from the league seed, so the
 * admin never sees the mapping being made. The draw cannot be redone, so its dialog shows who is in it (the roster and
 * its count, so a late enrolment that is missing is noticed), asks for the count to be typed back and asks for a reason.
 */
export default function RelationsAdmin({ seasonId, relations, actions, canReveal, roster }: RelationsAdminProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();
  const unmask = useAdminRequest();
  const reveal = useAdminRequest();
  const draw = useAdminRequest();
  const { statusRef, focusNow, focusOnClose, onCloseAutoFocus } = useStatusFocus();
  const [unmasked, setUnmasked] = useState<AdminUnmasked | null>(null);
  const [confirmUnmask, setConfirmUnmask] = useState(false);
  const [revealing, setRevealing] = useState<AdminRelationView | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<AdminRelationView | null>(null);
  const [drawn, setDrawn] = useState<string | null>(null);

  // The server page was read again (another island of the tab wrote, or this one did): the unmasked snapshot was read
  // against the old state, so it is dropped and the masked view of the new page shows. The admin can read it again.
  // (Adjusting state while rendering, as React allows for state derived from a prop.)
  const [seen, setSeen] = useState(relations);
  if (seen !== relations) {
    setSeen(relations);
    setUnmasked(null);
  }

  const shown: readonly AdminRelationView[] = unmasked?.relations ?? relations;
  const refName = (ref: PlayerRef | null): string => (ref === null ? t('relations.hiddenSide') : (ref.name ?? t('formerPlayer')));
  const actionName = (id: string): string => labelText(actions.find((action) => action.id === id)?.label, locale, id);

  async function runUnmask() {
    const out = await unmask.run(() => unmaskRelationsRequest(seasonId));
    // Success swaps the Show hidden button for the badge and Hide again: focus goes to the status line, not to <body>.
    if (out.ok) focusOnClose();
    setConfirmUnmask(false);
    if (out.ok) setUnmasked(out.data);
  }

  async function runReveal(reason: string) {
    if (revealing === null) return;
    setRevealed(null);
    setDrawn(null);
    const out = await reveal.run(() =>
      applyAdjustmentRequest(seasonId, { reason, adjustment: { kind: 'relation', relation: revealing.key, reveal: true } }),
    );
    if (!out.ok) return;
    // The relation's Reveal button is gone once the refreshed page lands: focus goes to the status line instead.
    focusOnClose();
    setRevealed(labelText(revealing.label, locale, revealing.key));
    setDrawn(null);
    setRevealing(null);
    // What was unmasked before the reveal is out of date; the admin can read it again.
    setUnmasked(null);
    reveal.refresh();
  }

  async function runDraw(reason: string) {
    if (drawing === null) return;
    setRevealed(null);
    setDrawn(null);
    const out = await draw.run(() =>
      applyAdjustmentRequest(seasonId, { reason, adjustment: { kind: 'relation', relation: drawing.key, draw: true } }),
    );
    if (!out.ok) return;
    focusOnClose();
    setDrawn(labelText(drawing.label, locale, drawing.key));
    setRevealed(null);
    setDrawing(null);
    setUnmasked(null);
    draw.refresh();
  }

  if (relations.length === 0 && actions.length === 0) {
    return <p className="text-sm text-poke-text-muted">{t('relations.empty')}</p>;
  }

  return (
    <div className="space-y-4" data-live-relations>
      <p className="text-sm text-poke-text-secondary">{t('relations.intro')}</p>
      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm text-poke-green focus:outline-none">
        {revealed !== null ? t('relations.revealed', { relation: revealed }) : drawn !== null ? t('relations.drawn', { relation: drawn }) : ''}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {unmasked === null ? (
          <Button variant="secondary" size="sm" className={BUTTON_TOUCH} loading={unmask.pending} onClick={() => setConfirmUnmask(true)}>
            {t('relations.showHidden')}
          </Button>
        ) : (
          <>
            <Badge variant="yellow">{t('relations.unmaskedBadge')}</Badge>
            <Button
              variant="ghost"
              size="sm"
              className={BUTTON_TOUCH}
              onClick={() => {
                // This button leaves with the unmasked state: move focus off it first.
                focusNow();
                setUnmasked(null);
              }}
            >
              {t('relations.hideAgain')}
            </Button>
          </>
        )}
      </div>
      {unmask.errorMessage !== null && <Alert variant="error">{unmask.errorMessage}</Alert>}

      <ul className="space-y-3">
        {shown.map((relation) => (
          <li key={relation.key} className="space-y-3 rounded-poke-md border border-poke-border bg-poke-surface p-4" data-relation-key={relation.key}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-heading font-semibold text-poke-text-primary">{labelText(relation.label, locale, relation.key)}</h3>
              <Badge variant="gray">{t(`relations.shape.${relation.shape}`)}</Badge>
              <span className="text-xs text-poke-text-muted">{t('relations.linkCount', { count: relation.link_count })}</span>
              {isRevealed(relation) && <Badge variant="green">{t('relations.publicBadge')}</Badge>}
            </div>
            {relation.links.length === 0 ? (
              <p className="text-sm text-poke-text-muted">
                {relation.link_count === 0 ? t('relations.noLinks') : relation.masked ? t('relations.noneVisible') : t('relations.noLinks')}
              </p>
            ) : (
              <ScrollRegion label={t('relations.linksCaption', { relation: labelText(relation.label, locale, relation.key) })}>
                <table className="w-full min-w-[20rem] text-left text-sm">
                  <caption className="sr-only">{t('relations.linksCaption', { relation: labelText(relation.label, locale, relation.key) })}</caption>
                  <thead className="bg-poke-muted text-xs font-heading text-poke-text-secondary">
                    <tr>
                      <th scope="col" className="px-3 py-2">{t('relations.from')}</th>
                      <th scope="col" className="px-3 py-2">{t('relations.to')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-poke-border">
                    {relation.links.map((link, index) => (
                      <tr key={index}>
                        <td className="px-3 py-2 text-poke-text-primary">{refName(link.from)}</td>
                        <td className="px-3 py-2 text-poke-text-primary">{refName(link.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
            {canReveal && relation.link_count === 0 && relation.shape !== 'manual' && (
              <Button
                variant="secondary"
                size="sm"
                className={BUTTON_TOUCH}
                aria-label={t('relations.drawAria', { relation: labelText(relation.label, locale, relation.key) })}
                onClick={() => setDrawing(relation)}
              >
                {t('relations.draw')}
              </Button>
            )}
            {canReveal && relation.link_count > 0 && !isRevealed(relation) && (
              <Button
                variant="secondary"
                size="sm"
                className={BUTTON_TOUCH}
                aria-label={t('relations.revealAria', { relation: labelText(relation.label, locale, relation.key) })}
                onClick={() => setRevealing(relation)}
              >
                {t('relations.reveal')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {unmasked !== null && unmasked.submissions.length > 0 && (
        <div className="space-y-3" data-live-submissions>
          <h3 className="text-sm font-heading font-semibold text-poke-text-primary">{t('relations.submissionsHeading')}</h3>
          {unmasked.submissions.map((entry) => (
            <div key={entry.action} className="space-y-2">
              <h4 className="text-sm text-poke-text-secondary">{actionName(entry.action)}</h4>
              {entry.rows.length === 0 ? (
                <p className="text-sm text-poke-text-muted">{t('relations.noSubmissions')}</p>
              ) : (
                <ScrollRegion label={t('relations.submissionsCaption', { action: actionName(entry.action) })}>
                  <table className="w-full min-w-[24rem] text-left text-sm">
                    <caption className="sr-only">{t('relations.submissionsCaption', { action: actionName(entry.action) })}</caption>
                    <thead className="bg-poke-muted text-xs font-heading text-poke-text-secondary">
                      <tr>
                        <th scope="col" className="px-3 py-2">{t('relations.player')}</th>
                        <th scope="col" className="px-3 py-2">{t('relations.state')}</th>
                        <th scope="col" className="px-3 py-2">{t('relations.target')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-poke-border">
                      {entry.rows.map((row) => (
                        <tr key={row.player.id}>
                          <td className="px-3 py-2 text-poke-text-primary">{row.player.name ?? t('formerPlayer')}</td>
                          <td className="px-3 py-2 text-poke-text-secondary">{t(`relations.submission.${row.state}`)}</td>
                          <td className="px-3 py-2 text-poke-text-primary">{row.target === null ? t('relations.noTarget') : refName(row.target)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmUnmask}
        onClose={() => setConfirmUnmask(false)}
        onConfirm={() => void runUnmask()}
        title={t('relations.unmaskTitle')}
        message={t('relations.unmaskBody')}
        confirmLabel={t('relations.unmaskConfirm')}
        confirmVariant="primary"
        loading={unmask.pending}
        onCloseAutoFocus={onCloseAutoFocus}
      />
      <ReasonDialog
        open={revealing !== null}
        onClose={() => {
          setRevealing(null);
          reveal.clearError();
        }}
        title={revealing === null ? '' : t('relations.revealTitle', { relation: labelText(revealing.label, locale, revealing.key) })}
        message={<p>{t('relations.revealBody')}</p>}
        confirmLabel={t('relations.reveal')}
        error={reveal.errorMessage}
        pending={reveal.pending}
        onConfirm={(reason) => void runReveal(reason)}
        onCloseAutoFocus={onCloseAutoFocus}
      />
      <ReasonDialog
        open={drawing !== null}
        onClose={() => {
          setDrawing(null);
          draw.clearError();
        }}
        title={drawing === null ? '' : t('relations.drawTitle', { relation: labelText(drawing.label, locale, drawing.key) })}
        message={
          <>
            <p>{t('relations.drawBody')}</p>
            <p className="font-semibold text-poke-text-primary">{t('relations.drawRoster', { count: roster.length })}</p>
            {roster.length === 0 ? (
              <p>{t('relations.drawRosterEmpty')}</p>
            ) : (
              <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5" data-draw-roster>
                {roster.map((player) => (
                  <li key={player.id}>{refName(player)}</li>
                ))}
              </ul>
            )}
          </>
        }
        typedConfirmation={{ label: t('relations.drawConfirmLabel', { count: roster.length }), expected: String(roster.length) }}
        confirmLabel={t('relations.draw')}
        error={draw.errorMessage}
        pending={draw.pending}
        onConfirm={(reason) => void runDraw(reason)}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </div>
  );
}
