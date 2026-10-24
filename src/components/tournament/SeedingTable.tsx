'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdminTournamentParticipant, PublicPlayerRef } from '@/lib/players/public-player';
import type { BracketType } from '@/types/tournament';
import type { EnrollmentSource } from '@/types/season';
import type { ApiResult } from '@/types/api';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import GuestBadge from '@/components/shared/GuestBadge';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import { useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { apiFailure, type UiError } from './ui-error';
import { buildSeedPayload, reorderIds, seedsFromOrder, sortBySeedEdits } from './seeding-order';

type SeedingErrorKey =
  | 'seeding.seedsPositive'
  | 'seeding.seedsDuplicate'
  | 'seeding.saveFailed'
  | 'seeding.reimportFailed'
  | 'seeding.seedByRatingFailed';

/**
 * `P` is the caller's roster row type. The table reads only the
 * `AdminTournamentParticipant` fields and hands rows back unchanged apart from
 * `seed` and `starting_bracket`, so any wider row type passes through.
 */
export interface SeedingTableProps<P extends AdminTournamentParticipant = AdminTournamentParticipant> {
  tournamentId: string;
  seasonId: string | null;
  enrollmentSource: EnrollmentSource | null;
  sourcePhaseName: string | null;
  /**
   * The roster as `GET /api/tournaments/[id]/participants` returns it to a
   * tournament admin (`AdminTournamentParticipant`: id, name, avatar, seed,
   * starting bracket, guest flag). Nothing else of the player is read.
   */
  participants: readonly P[];
  ratings: Record<string, number | null>;
  /**
   * Players that can be added. Only id and name are read, so the prop asks for
   * no more: callers may pass full rows (the admin roster), but a narrow list
   * works the same (boundary shape, see `src/lib/players/public-player.ts`).
   */
  allPlayers: readonly PublicPlayerRef[];
  /**
   * Receives the re-seeded or re-read roster. A re-read comes straight from
   * the participants API, so at runtime its rows are the admin shape whatever
   * `P` says (`ParticipantManager` still types its state as full rows).
   */
  onParticipantsChange: (participants: P[]) => void;
  onEnrollmentChange: (source: EnrollmentSource | null) => void;
  onAddPlayer: (playerId: string) => Promise<void>;
  onRemovePlayer: (playerId: string) => Promise<void>;
  bracketType?: BracketType | null;
  editable?: boolean;
}

export default function SeedingTable<P extends AdminTournamentParticipant>({
  tournamentId,
  seasonId,
  enrollmentSource,
  sourcePhaseName,
  participants,
  ratings,
  allPlayers,
  onParticipantsChange,
  onEnrollmentChange,
  onAddPlayer,
  onRemovePlayer,
  bracketType = null,
  editable = true,
}: SeedingTableProps<P>) {
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    participants.map((p) => p.id)
  );
  const [seedEdits, setSeedEdits] = useState<Record<string, string>>(() => {
    const edits: Record<string, string> = {};
    for (const p of participants) {
      edits[p.id] = p.seed !== null ? String(p.seed) : '';
    }
    return edits;
  });
  const [startingBrackets, setStartingBrackets] = useState<
    Record<string, 'winners' | 'losers'>
  >(() => {
    const map: Record<string, 'winners' | 'losers'> = {};
    for (const p of participants) {
      map[p.id] = p.starting_bracket ?? 'winners';
    }
    return map;
  });
  const t = useT(tournamentsAdminMessages);
  const errorText = useApiErrorText(errorsTournaments, errorsSeasons);
  const [error, setError] = useState<UiError<SeedingErrorKey> | null>(null);
  const [savingSeeds, setSavingSeeds] = useState(false);
  const [seedsDirty, setSeedsDirty] = useState(false);
  // Set by a successful save; any later edit sets `seedsDirty` again, which hides the notice.
  const [seedsSaved, setSeedsSaved] = useState(false);
  /** The list was reordered (or renumbered by position) since the last save or re-read. */
  const [orderTouched, setOrderTouched] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [seedingRating, setSeedingRating] = useState(false);
  const dragIndex = useRef<number | null>(null);

  // Keep internal ordering and per-player edits in sync when participants are
  // added or removed by the parent (Add/Remove). Without this, `orderedIds`
  // keeps stale IDs after a removal, so saveSeeds() would submit a player that
  // is no longer a participant and the API rejects it with
  // "Player <id> is not a participant".
  useEffect(() => {
    const currentIds = new Set(participants.map((p) => p.id));
    setOrderedIds((prev) => {
      const kept = prev.filter((id) => currentIds.has(id));
      const added = participants
        .filter((p) => !prev.includes(p.id))
        .map((p) => p.id);
      return added.length ? [...kept, ...added] : kept;
    });
    setSeedEdits((prev) => {
      const next: Record<string, string> = {};
      for (const p of participants) {
        next[p.id] = prev[p.id] ?? (p.seed !== null ? String(p.seed) : '');
      }
      return next;
    });
    setStartingBrackets((prev) => {
      const next: Record<string, 'winners' | 'losers'> = {};
      for (const p of participants) {
        next[p.id] = prev[p.id] ?? p.starting_bracket ?? 'winners';
      }
      return next;
    });
  }, [participants]);

  const participantMap = new Map(participants.map((p) => [p.id, p]));
  const orderedParticipants = orderedIds
    .map((id) => participantMap.get(id))
    .filter((p): p is P => p !== undefined);

  const syncStatus =
    seasonId && enrollmentSource
      ? enrollmentSource.frozen
        ? t('seeding.frozen')
        : t('seeding.synced')
      : null;

  function reorder(from: number, to: number) {
    const next = reorderIds(orderedIds, from, to);
    if (next === orderedIds) return;
    // The visible order is authoritative: every row is renumbered by position,
    // so what Save writes is what the admin sees.
    setOrderedIds(next);
    setSeedEdits(seedsFromOrder(next));
    setSeedsDirty(true);
    setOrderTouched(true);
  }

  /** Re-sorts the list to match the typed numbers (on blur and Enter, not per keystroke). */
  function commitSeedEdits() {
    setOrderedIds((prev) => {
      const next = sortBySeedEdits(prev, seedEdits);
      return next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }

  function handleSeedChange(playerId: string, value: string) {
    setSeedEdits((prev) => ({ ...prev, [playerId]: value }));
    setSeedsDirty(true);
  }

  function autoSeed() {
    setSeedEdits(seedsFromOrder(orderedIds));
    setSeedsDirty(true);
    setOrderTouched(true);
  }

  function clearSeeds() {
    const edits: Record<string, string> = {};
    for (const id of orderedIds) edits[id] = '';
    setSeedEdits(edits);
    setSeedsDirty(true);
    setOrderTouched(false);
  }

  function shuffleSeeds() {
    const shuffled = [...orderedIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setOrderedIds(shuffled);
    setSeedEdits(seedsFromOrder(shuffled));
    setSeedsDirty(true);
    setOrderTouched(true);
  }

  async function saveSeeds() {
    setError(null);
    setSeedsSaved(false);
    setSavingSeeds(true);

    const seeds = buildSeedPayload(
      orderedParticipants.map((p) => p.id),
      seedEdits,
      startingBrackets,
      bracketType
    );

    for (const entry of seeds) {
      if (entry.seed !== null && (Number.isNaN(entry.seed) || entry.seed < 1)) {
        setError({ key: 'seeding.seedsPositive' });
        setSavingSeeds(false);
        return;
      }
    }

    const nonNull = seeds.filter((e) => e.seed !== null).map((e) => e.seed);
    if (new Set(nonNull).size !== nonNull.length) {
      setError({ key: 'seeding.seedsDuplicate' });
      setSavingSeeds(false);
      return;
    }

    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeds }),
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError(apiFailure(result));
        return;
      }

      const updated = orderedParticipants.map((p) => ({
        ...p,
        seed: seeds.find((s) => s.player_id === p.id)?.seed ?? null,
        starting_bracket:
          seeds.find((s) => s.player_id === p.id)?.starting_bracket ??
          startingBracketOf(p.id, p.starting_bracket),
      }));
      onParticipantsChange(updated);
      if (enrollmentSource) {
        onEnrollmentChange({ ...enrollmentSource, frozen: true });
      }
      setSeedsDirty(false);
      setOrderTouched(false);
      setSeedsSaved(true);
    } catch {
      setError({ key: 'seeding.saveFailed' });
    } finally {
      setSavingSeeds(false);
    }
  }

  async function reimportStandings(force = false) {
    if (!seasonId) return;
    setSyncing(true);
    setError(null);
    setSeedsSaved(false);
    try {
      const res = await fetch(
        `/api/seasons/${seasonId}/phases/${tournamentId}/participants/sync-standings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(force ? { force: true } : {}),
        }
      );
      const result: ApiResult<{
        enrolled_count: number;
        enrollment_source: EnrollmentSource;
        source_phase_name: string | null;
        code?: string;
      }> = await res.json();
      if (!result.success) {
        const needsForce =
          result.code === 'ENROLLMENT_FROZEN' || result.code === 'ENROLLMENT_ROUNDS_EXIST';
        if (needsForce) {
          const confirmed = window.confirm(t('seeding.reimportConfirm'));
          if (confirmed) {
            setSyncing(false);
            await reimportStandings(true);
            return;
          }
        }
        setError(apiFailure(result));
        return;
      }
      const partRes = await fetch(`/api/tournaments/${tournamentId}/participants`);
      const partJson: ApiResult<P[]> = await partRes.json();
      if (partJson.success) {
        onParticipantsChange(partJson.data);
        setOrderedIds(partJson.data.map((p) => p.id));
        const edits: Record<string, string> = {};
        const brackets: Record<string, 'winners' | 'losers'> = {};
        for (const p of partJson.data) {
          edits[p.id] = p.seed !== null ? String(p.seed) : '';
          brackets[p.id] = p.starting_bracket ?? 'winners';
        }
        setSeedEdits(edits);
        setStartingBrackets(brackets);
        setOrderTouched(false);
        onEnrollmentChange(result.data.enrollment_source);
      }
    } catch {
      setError({ key: 'seeding.reimportFailed' });
    } finally {
      setSyncing(false);
    }
  }

  async function seedByRating() {
    if (!seasonId) return;
    setSeedingRating(true);
    setError(null);
    setSeedsSaved(false);
    try {
      const res = await fetch(
        `/api/seasons/${seasonId}/phases/${tournamentId}/participants/seed-by-rating`,
        { method: 'POST' }
      );
      const result: ApiResult<{ seeds: Array<{ player_id: string; seed: number }> }> =
        await res.json();
      if (!result.success) {
        setError(apiFailure(result));
        return;
      }
      const partRes = await fetch(`/api/tournaments/${tournamentId}/participants`);
      const partJson: ApiResult<P[]> = await partRes.json();
      if (partJson.success) {
        const sorted = [...partJson.data].sort((a, b) => {
          if (a.seed !== null && b.seed !== null) return a.seed - b.seed;
          return 0;
        });
        onParticipantsChange(sorted);
        setOrderedIds(sorted.map((p) => p.id));
        const edits: Record<string, string> = {};
        const brackets: Record<string, 'winners' | 'losers'> = {};
        for (const p of sorted) {
          edits[p.id] = p.seed !== null ? String(p.seed) : '';
          brackets[p.id] = p.starting_bracket ?? 'winners';
        }
        setSeedEdits(edits);
        setStartingBrackets(brackets);
        setSeedsDirty(false);
        setOrderTouched(false);
        if (enrollmentSource) {
          onEnrollmentChange({ ...enrollmentSource, frozen: true });
        }
      }
    } catch {
      setError({ key: 'seeding.seedByRatingFailed' });
    } finally {
      setSeedingRating(false);
    }
  }

  const participantIds = new Set(orderedIds);
  const availablePlayers = allPlayers.filter((p) => !participantIds.has(p.id));
  const showLbToggle = bracketType === 'double_elim' && editable;

  function startingBracketOf(playerId: string, fallback?: 'winners' | 'losers'): 'winners' | 'losers' {
    return startingBrackets[playerId] ?? fallback ?? 'winners';
  }

  function toggleLbStart(playerId: string) {
    if (!editable) return;
    setStartingBrackets((prev) => ({
      ...prev,
      [playerId]: (prev[playerId] ?? 'winners') === 'losers' ? 'winners' : 'losers',
    }));
    setSeedsDirty(true);
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{'api' in error ? errorText(error.api) : t(error.key)}</Alert>}

      {syncStatus && (
        <p className="text-xs text-poke-text-secondary">
          {syncStatus}
          {sourcePhaseName ? ` · ${t('seeding.source', { name: sourcePhaseName })}` : ''}
          {enrollmentSource?.synced_at ? (
            <>
              {' · '}
              {t.rich('seeding.lastSync', {
                time: <LocalTime value={enrollmentSource.synced_at} preset="dateTimeYear" />,
              })}
            </>
          ) : null}
        </p>
      )}

      {!editable && (
        <p className="text-xs text-poke-text-muted">
          {t('seeding.locked')}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-heading font-semibold text-poke-text-primary">
          {t('seeding.heading', { count: orderedParticipants.length })}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {seasonId && enrollmentSource?.frozen && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void reimportStandings()}
              loading={syncing}
              disabled={!editable}
            >
              {t('seeding.reimport')}
            </Button>
          )}
          {seasonId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={seedByRating}
              loading={seedingRating}
              disabled={!editable}
            >
              {t('seeding.seedByRating')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={shuffleSeeds} disabled={!editable}>
            {t('seeding.shuffle')}
          </Button>
          <Button variant="ghost" size="sm" onClick={autoSeed} disabled={!editable}>
            {t('seeding.autoSeed')}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSeeds} disabled={!editable}>
            {t('seeding.clear')}
          </Button>
          {seedsDirty && editable && (
            <Button variant="secondary" size="sm" onClick={saveSeeds} loading={savingSeeds}>
              {t('seeding.save')}
            </Button>
          )}
        </div>
      </div>

      {/* A live region that is always rendered, so the screen reader announces the text when it appears. */}
      <p role="status" className="text-xs text-poke-green">
        {seedsSaved && !seedsDirty ? t('seeding.saved') : null}
      </p>

      {orderTouched && seedsDirty && editable && (
        <p className="text-xs text-poke-text-muted">
          {t('seeding.orderHint', { count: orderedParticipants.length })}
        </p>
      )}

      {orderedParticipants.length === 0 ? (
        <p className="text-sm text-poke-text-muted">{t('seeding.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {orderedParticipants.map((p, index) => (
            <li
              key={p.id}
              draggable={editable}
              onDragStart={() => { if (editable) dragIndex.current = index; }}
              onDragOver={(e) => { if (editable) e.preventDefault(); }}
              onDrop={() => {
                if (editable && dragIndex.current !== null) reorder(dragIndex.current, index);
                dragIndex.current = null;
              }}
              className="flex items-center justify-between p-2 bg-poke-elevated rounded-poke-md text-sm text-poke-text-primary gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-poke-text-muted cursor-grab select-none" aria-hidden="true">⋮⋮</span>
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    className="text-[10px] text-poke-text-muted hover:text-poke-text-primary"
                    onClick={() => reorder(index, index - 1)}
                    disabled={!editable || index === 0}
                    aria-label={t('seeding.moveUp')}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-poke-text-muted hover:text-poke-text-primary"
                    onClick={() => reorder(index, index + 1)}
                    disabled={!editable || index === orderedParticipants.length - 1}
                    aria-label={t('seeding.moveDown')}
                  >
                    ▼
                  </button>
                </div>
                <input
                  type="number"
                  min="1"
                  placeholder="#"
                  value={seedEdits[p.id] ?? ''}
                  onChange={(e) => handleSeedChange(p.id, e.target.value)}
                  onBlur={commitSeedEdits}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitSeedEdits();
                  }}
                  disabled={!editable}
                  className="w-12 px-1.5 py-0.5 text-center text-xs border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary disabled:opacity-60"
                />
                <PlayerAvatar avatarUrl={p.avatar_url} name={p.name} size={20} />
                <span className="truncate">{p.name}</span>
                {p.is_guest && <GuestBadge />}
                {startingBracketOf(p.id, p.starting_bracket) === 'losers' && (
                  <Badge variant="purple" size="xs">{t('seeding.losersBadge')}</Badge>
                )}
                {ratings[p.id] != null && (
                  <span className="text-xs text-poke-text-muted">{ratings[p.id]}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {showLbToggle && (
                  <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                    <input
                      type="checkbox"
                      checked={startingBracketOf(p.id, p.starting_bracket) === 'losers'}
                      onChange={() => toggleLbStart(p.id)}
                    />
                    {t('seeding.startInLosers')}
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => onRemovePlayer(p.id)}
                  disabled={!editable}
                  className="text-xs text-poke-danger hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {t('seeding.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable && availablePlayers.length > 0 && (
        <div>
          <h3 className="text-sm font-heading font-semibold text-poke-text-primary mb-2">{t('seeding.addPlayer')}</h3>
          <div className="flex gap-2 flex-wrap">
            {availablePlayers.map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                size="sm"
                onClick={() => onAddPlayer(p.id)}
                className="border border-poke-border"
              >
                + {p.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
