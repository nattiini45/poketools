'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResult } from '@/types/api';
import type { CoreTriple } from '@/types/season';
import { POKEMON_TYPES } from '@/types/season';
import { isTripleInPool, tripleKey } from '@/lib/season/core-assignment';
import { formatPack } from '@/lib/format-pack';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Table, { type Column } from '@/components/ui/Table';
import TypeSprite from '@/components/shared/TypeSprite';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueRosterMessages } from '@/i18n/messages/league-roster';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';

interface CoresResponse {
  pool: CoreTriple[] | null;
  participants: Array<{
    playerId: string;
    playerName: string;
    coreTypes: CoreTriple | null;
    coreAssignedAt: string | null;
  }>;
}

interface CoreLigaManagerProps {
  seasonId: string;
}

/** The triple a new pool row starts with (format pack `coreLiga.newTripleDefault`). */
const EMPTY_TRIPLE: CoreTriple = formatPack.coreLiga.newTripleDefault;

/**
 * What the manager shows as an error: the server's refusal (by its code, in
 * the viewer's language), or a local check or failed request (a message key;
 * a pool check names the offending triple, localized when shown).
 */
type CoresError =
  | { api: ApiErrorLike }
  | { key: 'loadFailed' | 'poolEmpty' | 'selectCore' | 'requestFailed' }
  | { key: 'duplicateTypes' | 'duplicateTriple'; triple: CoreTriple };

/** A success note, kept as a key (and its numbers) so a language switch re-renders it. */
type CoresInfo =
  | { key: 'poolSaved' | 'coreSaved' | 'coreCleared' }
  | { key: 'assigned'; assigned: number; kept: number };

function triplesEqual(a: CoreTriple, b: CoreTriple): boolean {
  return tripleKey(a) === tripleKey(b);
}

function takenTripleKeys(
  participants: CoresResponse['participants'],
  excludePlayerId?: string,
): Set<string> {
  const taken = new Set<string>();
  for (const p of participants) {
    if (p.coreTypes && p.playerId !== excludePlayerId) {
      taken.add(tripleKey(p.coreTypes));
    }
  }
  return taken;
}

function defaultPoolKey(
  pool: CoreTriple[],
  participants: CoresResponse['participants'],
  playerId: string,
): string {
  const taken = takenTripleKeys(participants, playerId);
  for (const triple of pool) {
    const key = tripleKey(triple);
    if (!taken.has(key)) return key;
  }
  return pool.length > 0 ? tripleKey(pool[0]) : '';
}

function draftSelectionFromParticipants(
  pool: CoreTriple[],
  participants: CoresResponse['participants'],
): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const p of participants) {
    if (p.coreTypes && isTripleInPool(pool, p.coreTypes)) {
      drafts[p.playerId] = tripleKey(p.coreTypes);
    } else {
      drafts[p.playerId] = defaultPoolKey(pool, participants, p.playerId);
    }
  }
  return drafts;
}

function availablePoolOptions(
  pool: CoreTriple[],
  participants: CoresResponse['participants'],
  playerId: string,
): CoreTriple[] {
  const taken = takenTripleKeys(participants, playerId);
  return pool.filter((triple) => !taken.has(tripleKey(triple)));
}

/**
 * Admin tool for managing a Core Liga season:
 *  - edit the curated pool of allowed type triples
 *  - manually assign or clear cores per participant (pool entries only)
 *  - randomly assign cores to every participant (idempotent + force-reroll)
 */
export default function CoreLigaManager({ seasonId }: CoreLigaManagerProps) {
  const t = useT(leagueRosterMessages);
  const dataLocale = useDataLocale();
  const formatter = useFormatter();
  const errorText = useApiErrorText(errorsSeasons);
  /** A triple's types in the viewer's Pokémon language, joined by `separator`. */
  const tripleLabel = (triple: readonly string[], separator: string) =>
    triple.map((type) => localizeType(type, dataLocale)).join(separator);
  const [data, setData] = useState<CoresResponse | null>(null);
  const [draftPool, setDraftPool] = useState<CoreTriple[]>([]);
  const [draftSelection, setDraftSelection] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [rowBusy, setRowBusy] = useState<Record<string, 'save' | 'clear'>>({});
  const [error, setError] = useState<CoresError | null>(null);
  const [info, setInfo] = useState<CoresInfo | null>(null);
  const [forceReroll, setForceReroll] = useState(false);

  const savedPool = data?.pool ?? [];

  const reloadCores = useCallback(async () => {
    const fresh = await fetch(`/api/seasons/${seasonId}/cores`).then((r) => r.json()) as ApiResult<CoresResponse>;
    if (fresh.success) {
      const pool = fresh.data.pool ?? [];
      setData(fresh.data);
      setDraftSelection(draftSelectionFromParticipants(pool, fresh.data.participants));
    }
    return fresh;
  }, [seasonId]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/seasons/${seasonId}/cores`)
      .then((r) => r.json())
      .then((res: ApiResult<CoresResponse>) => {
        if (res.success) {
          const pool = res.data.pool ?? [];
          setData(res.data);
          setDraftPool(pool);
          setDraftSelection(draftSelectionFromParticipants(pool, res.data.participants));
        } else {
          setError({ api: toApiErrorLike(res) });
        }
      })
      .catch(() => setError({ key: 'loadFailed' }))
      .finally(() => setLoading(false));
  }, [seasonId]);

  function updateTriple(idx: number, slot: 0 | 1 | 2, type: string) {
    setDraftPool((prev) => {
      const next = [...prev];
      const triple: CoreTriple = [...next[idx]] as CoreTriple;
      triple[slot] = type;
      next[idx] = triple;
      return next;
    });
  }

  function updateParticipantSelection(playerId: string, key: string) {
    setDraftSelection((prev) => ({ ...prev, [playerId]: key }));
  }

  function addTriple() {
    setDraftPool((prev) => [...prev, [...EMPTY_TRIPLE] as CoreTriple]);
  }

  function removeTriple(idx: number) {
    setDraftPool((prev) => prev.filter((_, i) => i !== idx));
  }

  function validatePool(pool: CoreTriple[]): CoresError | null {
    if (pool.length === 0) return { key: 'poolEmpty' };
    const seen = new Set<string>();
    for (const triple of pool) {
      if (triple[0] === triple[1] || triple[0] === triple[2] || triple[1] === triple[2]) {
        return { key: 'duplicateTypes', triple };
      }
      const key = tripleKey(triple);
      if (seen.has(key)) return { key: 'duplicateTriple', triple };
      seen.add(key);
    }
    return null;
  }

  function tripleFromKey(pool: CoreTriple[], key: string): CoreTriple | null {
    return pool.find((triple) => tripleKey(triple) === key) ?? null;
  }

  async function savePool() {
    setError(null);
    setInfo(null);
    const validation = validatePool(draftPool);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/cores`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ core_pool: draftPool }),
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setData((prev) => (prev ? { ...prev, pool: draftPool } : prev));
      if (data) {
        setDraftSelection(draftSelectionFromParticipants(draftPool, data.participants));
      }
      setInfo({ key: 'poolSaved' });
    } catch {
      setError({ key: 'requestFailed' });
    } finally {
      setSaving(false);
    }
  }

  async function assignCores() {
    setError(null);
    setInfo(null);
    setAssigning(true);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/cores/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: forceReroll }),
      });
      const result: ApiResult<{ assignedCount: number; skippedCount: number }> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setInfo({ key: 'assigned', assigned: result.data.assignedCount, kept: result.data.skippedCount });
      await reloadCores();
    } catch {
      setError({ key: 'requestFailed' });
    } finally {
      setAssigning(false);
    }
  }

  async function saveParticipantCore(playerId: string, key: string) {
    const coreTypes = tripleFromKey(savedPool, key);
    if (!coreTypes) {
      setError({ key: 'selectCore' });
      return;
    }
    setError(null);
    setInfo(null);
    setRowBusy((prev) => ({ ...prev, [playerId]: 'save' }));
    try {
      const res = await fetch(`/api/seasons/${seasonId}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, core_types: coreTypes }),
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setInfo({ key: 'coreSaved' });
      await reloadCores();
    } catch {
      setError({ key: 'requestFailed' });
    } finally {
      setRowBusy((prev) => {
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
    }
  }

  async function clearParticipantCore(playerId: string) {
    setError(null);
    setInfo(null);
    setRowBusy((prev) => ({ ...prev, [playerId]: 'clear' }));
    try {
      const res = await fetch(`/api/seasons/${seasonId}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, core_types: null }),
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setInfo({ key: 'coreCleared' });
      await reloadCores();
    } catch {
      setError({ key: 'requestFailed' });
    } finally {
      setRowBusy((prev) => {
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
    }
  }

  type ParticipantRow = CoresResponse['participants'][number];

  if (loading) return <p className="text-sm text-poke-text-muted">{t('cores.loading')}</p>;
  if (!data) return null;

  function errorMessage(e: CoresError): string {
    if ('api' in e) return errorText(e.api);
    if ('triple' in e) return t(`cores.errors.${e.key}`, { triple: tripleLabel(e.triple, '/') });
    return t(`cores.errors.${e.key}`);
  }

  function infoMessage(note: CoresInfo): string {
    if (note.key === 'assigned') {
      return t('cores.info.assigned', { assigned: note.assigned, kept: note.kept });
    }
    return t(`cores.info.${note.key}`);
  }

  const participantColumns: Column<ParticipantRow>[] = [
    {
      key: 'player',
      header: t('cores.columns.player'),
      sortable: true,
      sortValue: (p) => p.playerName,
      render: (p) => p.playerName,
    },
    {
      key: 'core',
      header: t('cores.columns.core'),
      render: (p) => {
        const selectedKey = draftSelection[p.playerId] ?? '';
        const options = availablePoolOptions(savedPool, data.participants, p.playerId);
        const hasCore = p.coreTypes !== null;
        const offPool = hasCore && p.coreTypes && !isTripleInPool(savedPool, p.coreTypes);

        return (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedKey}
              onChange={(e) => updateParticipantSelection(p.playerId, e.target.value)}
              className="border border-poke-border bg-poke-surface rounded-poke-md px-1.5 py-1 text-xs text-poke-text-primary min-w-[10rem]"
            >
              {options.map((triple) => (
                <option key={tripleKey(triple)} value={tripleKey(triple)}>
                  {tripleLabel(triple, ' / ')}
                </option>
              ))}
            </select>
            {hasCore && p.coreTypes && (
              <span className="inline-flex gap-0.5 items-center">
                {p.coreTypes.map((type) => (
                  <TypeSprite key={type} type={type} size={14} />
                ))}
                <span className="text-xs text-poke-text-secondary ml-1">
                  {tripleLabel(p.coreTypes, ' / ')}
                </span>
              </span>
            )}
            {offPool && (
              <span className="text-xs text-poke-danger">
                {t('cores.offPool')}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'assigned',
      header: t('cores.columns.assignedAt'),
      sortable: true,
      sortValue: (p) => p.coreAssignedAt ?? '',
      render: (p) => (
        <span className="text-xs text-poke-text-muted">
          {p.coreAssignedAt ? formatter.instant(p.coreAssignedAt, 'dateTimeYear') : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('cores.columns.actions'),
      render: (p) => {
        const selectedKey = draftSelection[p.playerId] ?? '';
        const selectedTriple = tripleFromKey(savedPool, selectedKey);
        const hasCore = p.coreTypes !== null;
        const unchanged = hasCore && p.coreTypes && selectedTriple
          ? triplesEqual(selectedTriple, p.coreTypes)
          : false;
        const busy = rowBusy[p.playerId];

        return (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={busy === 'save'}
              disabled={!selectedTriple || unchanged || busy != null}
              onClick={() => saveParticipantCore(p.playerId, selectedKey)}
            >
              {hasCore ? t('cores.save') : t('cores.assign')}
            </Button>
            {hasCore && (
              <Button
                variant="ghost"
                size="sm"
                loading={busy === 'clear'}
                disabled={busy != null}
                onClick={() => clearParticipantCore(p.playerId)}
                className="text-poke-danger hover:text-poke-danger"
              >
                {t('cores.clear')}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{errorMessage(error)}</Alert>}
      {info && <Alert variant="success">{infoMessage(info)}</Alert>}

      {/* Curated pool editor */}
      <div>
        <h4 className="font-heading font-semibold text-sm text-poke-text-primary mb-2">
          {t('cores.poolHeading', { count: draftPool.length })}
        </h4>
        <p className="text-xs text-poke-text-muted mb-3">{t('cores.poolHint')}</p>
        <div className="space-y-2">
          {draftPool.map((triple, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {[0, 1, 2].map((slot) => (
                <select
                  key={slot}
                  value={triple[slot as 0 | 1 | 2]}
                  onChange={(e) => updateTriple(idx, slot as 0 | 1 | 2, e.target.value)}
                  className="border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1 text-sm text-poke-text-primary"
                >
                  {POKEMON_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {localizeType(type, dataLocale)}
                    </option>
                  ))}
                </select>
              ))}
              <Button variant="ghost" size="sm" onClick={() => removeTriple(idx)}>
                {t('cores.remove')}
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" size="sm" onClick={addTriple}>
            {t('cores.addTriple')}
          </Button>
          <Button variant="success" size="sm" loading={saving} onClick={savePool}>
            {t('cores.savePool')}
          </Button>
        </div>
      </div>

      {/* Bulk random assign */}
      <div className="border-t border-poke-border pt-4">
        <h4 className="font-heading font-semibold text-sm text-poke-text-primary mb-2">
          {t('cores.bulkHeading')}
        </h4>
        <label className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            checked={forceReroll}
            onChange={(e) => setForceReroll(e.target.checked)}
            className="accent-poke-accent"
          />
          <span className="text-sm text-poke-text-primary">{t('cores.forceReroll')}</span>
        </label>
        <Button variant="primary" size="sm" loading={assigning} onClick={assignCores}>
          {forceReroll ? t('cores.rerollAll') : t('cores.assignMissing')}
        </Button>
      </div>

      {/* Participants table */}
      <div className="border-t border-poke-border pt-4">
        <h4 className="font-heading font-semibold text-sm text-poke-text-primary mb-2">
          {t('cores.participantsHeading', { count: data.participants.length })}
        </h4>
        <p className="text-xs text-poke-text-muted mb-3">{t('cores.participantsHint')}</p>
        {savedPool.length === 0 ? (
          <p className="text-sm text-poke-text-muted">{t('cores.savePoolFirst')}</p>
        ) : (
          <Table
            columns={participantColumns}
            data={data.participants}
            keyExtractor={(p) => p.playerId}
          />
        )}
      </div>
    </div>
  );
}
