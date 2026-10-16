'use client';

/**
 * Token balances per player for admins (draft-frontend §7.1): Draft Kill,
 * Comeback and Cosmo, all loaded in one request from BE #25b. "Details"
 * opens DF6's read-only `TokenCenter` for that player. The switch "Allow
 * Comeback Token spending" (BE #28) shows while the season has no completed
 * Redraft. Uses the spec's three token names, never the retired bare name.
 */
import { useEffect, useId, useState } from 'react';
import Button from '@/components/ui/Button';
import TokenCenter from '@/components/draft-tokens/TokenCenter';
import { createHttpTokenSource, type TokenSource } from '@/components/draft-tokens/token-source';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { PublicPlayerRef } from '@/lib/players/public-player';
import type { TokenOverviewDTO } from '@/types/draft-queue';
import { setComebackSpendOpen, type ApiCall } from './admin-actions';
import { HINT, InlineError, InlineNotice, TABLE, TD, TH } from './admin-ui';
import { useAdminCall } from './use-admin-call';

export interface TokenAdminSummaryProps {
  seasonId: string;
  /**
   * Line catalog for the read-only `TokenCenter` details. Optional so the
   * spec signature (§7.1) works as is: without it the Details column is hidden.
   */
  catalog?: DraftLineCatalog;
  participants: PublicPlayerRef[];
  comebackSpendOpen: boolean;
  /** The season has a completed Redraft (then the switch is hidden). */
  hasRedraft: boolean;
  /** Test/preview injection; default `createHttpTokenSource(seasonId)`. */
  source?: TokenSource;
  /** Test/preview injection for the Comeback switch (BE #28); default `setComebackSpendOpen(seasonId, open)`. */
  setComebackOpen?(open: boolean): Promise<ApiCall<{ open: boolean }>>;
}

export type TokenRow = { kind: 'loading' } | { kind: 'ready'; data: TokenOverviewDTO } | { kind: 'empty' } | { kind: 'error' };

/**
 * Loads every participant's row. One batched request (BE #25b) when the source has
 * `overviewAll`; in-memory sources without it fall back to one `overview` per player.
 * A participant missing from the batch renders the empty state.
 */
export async function loadTokenRows(
  source: TokenSource,
  participantIds: readonly string[],
): Promise<Record<string, TokenRow>> {
  if (source.overviewAll) {
    const res = await source.overviewAll();
    if (!res.ok) return Object.fromEntries(participantIds.map((id): [string, TokenRow] => [id, { kind: 'error' }]));
    const byPlayer = new Map(res.data.map((o) => [o.player_id, o]));
    return Object.fromEntries(
      participantIds.map((id): [string, TokenRow] => {
        const data = byPlayer.get(id);
        return [id, data ? { kind: 'ready', data } : { kind: 'empty' }];
      }),
    );
  }
  const results = await Promise.all(
    participantIds.map(async (id): Promise<[string, TokenRow]> => {
      const res = await source.overview(id);
      return [id, res.ok ? { kind: 'ready', data: res.data } : { kind: 'error' }];
    }),
  );
  return Object.fromEntries(results);
}

export default function TokenAdminSummary({
  seasonId,
  catalog,
  participants,
  comebackSpendOpen,
  hasRedraft,
  source,
  setComebackOpen: setComebackOpenAction,
}: TokenAdminSummaryProps) {
  const t = useT(draftAdminMessages);
  const errorText = useApiErrorText(errorsDraft);
  const switchId = useId();
  const [tokenSource] = useState<TokenSource>(() => source ?? createHttpTokenSource(seasonId));
  const [rows, setRows] = useState<Record<string, TokenRow>>({});
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [comebackOpen, setComebackOpen] = useState(comebackSpendOpen);
  const [changed, setChanged] = useState(false);
  const call = useAdminCall();

  useEffect(() => {
    let cancelled = false;
    void loadTokenRows(
      tokenSource,
      participants.map((p) => p.id),
    ).then((next) => {
      if (!cancelled) setRows(next);
    });
    return () => {
      cancelled = true;
    };
  }, [participants, tokenSource]);

  const toggleComeback = async (next: boolean) => {
    setChanged(false);
    const ok = await call.run(async () => {
      const res = await (setComebackOpenAction ? setComebackOpenAction(next) : setComebackSpendOpen(seasonId, next));
      return res.ok ? null : res.error;
    });
    if (ok) {
      setComebackOpen(next);
      setChanged(true);
    }
  };

  return (
    <div className="space-y-3">
      <p className={HINT}>{t('tokens.intro')}</p>

      {!hasRedraft ? (
        <div className="space-y-1 rounded-poke-md border border-poke-border p-3">
          <label htmlFor={switchId} className="flex items-center gap-2 text-sm font-semibold text-poke-text-primary">
            <input
              id={switchId}
              type="checkbox"
              role="switch"
              aria-checked={comebackOpen}
              checked={comebackOpen}
              disabled={call.busy}
              onChange={(e) => void toggleComeback(e.target.checked)}
            />
            {t('tokens.allowComeback')}
          </label>
          <p className={HINT}>{t('tokens.allowComebackHint')}</p>
          <InlineError text={call.error ? errorText(call.error) : null} />
          <InlineNotice
            text={changed ? (comebackOpen ? t('tokens.comebackOpen') : t('tokens.comebackClosed')) : null}
          />
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>{t('tokens.col.player')}</th>
              <th className={TH}>{t('tokens.col.draftKill')}</th>
              <th className={TH}>{t('tokens.col.comeback')}</th>
              <th className={TH}>{t('tokens.col.cosmo')}</th>
              {catalog ? <th className={TH} /> : null}
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => {
              const row: TokenRow = rows[p.id] ?? { kind: 'loading' };
              const expanded = openPlayer === p.id;
              return (
                <tr key={p.id} className="border-t border-poke-border">
                  <td className={TD}>{p.name}</td>
                  <TokenRowCells row={row} />
                  {catalog ? (
                    <td className={TD}>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-expanded={expanded}
                        onClick={() => setOpenPlayer(expanded ? null : p.id)}
                      >
                        {expanded ? t('tokens.hideDetails') : t('tokens.details')}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openPlayer && catalog ? (
        <div className="rounded-poke-md border border-poke-border p-3">
          <TokenCenter
            key={openPlayer}
            seasonId={seasonId}
            catalog={catalog}
            playerId={openPlayer}
            source={tokenSource}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The three balance cells of one participant row (exported for tests). */
export function TokenRowCells({ row }: { row: TokenRow }) {
  const t = useT(draftAdminMessages);
  if (row.kind === 'ready') {
    return (
      <>
        <td className={TD}>
          {t('tokens.draftKillValue', { owned: row.data.draft_kill.owned, max: row.data.draft_kill.max })}
        </td>
        <td className={TD}>
          {t('tokens.comebackValue', { unspent: row.data.comeback.unspent, earned: row.data.comeback.earned })}
        </td>
        <td className={TD}>{row.data.cosmo ? row.data.cosmo.tokens : t('tokens.none')}</td>
      </>
    );
  }
  if (row.kind === 'empty') {
    return (
      <>
        <td className={`${TD} text-poke-text-secondary`}>{t('tokens.none')}</td>
        <td className={`${TD} text-poke-text-secondary`}>{t('tokens.none')}</td>
        <td className={`${TD} text-poke-text-secondary`}>{t('tokens.none')}</td>
      </>
    );
  }
  return (
    <td className={`${TD} text-poke-text-secondary`} colSpan={3}>
      {row.kind === 'loading' ? t('tokens.loading') : t('tokens.loadFailed')}
    </td>
  );
}
