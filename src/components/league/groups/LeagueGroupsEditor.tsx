'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useLocale, useT } from '@/i18n/client';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueAdminGroupsMessages } from '@/i18n/messages/league-admin/groups';
import type { LeagueGroupsEditorDTO, LeagueGroupsEditorGroup } from '@/types/league-groups-editor';
import {
  clearWrite,
  editorLoadUpdate,
  loadEditor,
  placeWrite,
  renameWrite,
  runEditorWrite,
  splitWrite,
  type EditorLoadOutcome,
  type EditorWrite,
  type EditorWriteError,
} from './editor-requests';

interface LeagueGroupsEditorProps {
  seasonId: string;
}

/** `season_groups.sort_order` is 1..26; every group needs two trainers. */
const MAX_GROUPS = 26;
const MIN_GROUP_SIZE = 2;

/** An API refusal (rendered from its code), or a request that got no answer. */
type EditorError = EditorWriteError;

/** Native selects and buttons reach 44px on phones (touch targets), the compact size from `sm` up. */
const TOUCH = 'min-h-11 sm:min-h-0';
const MEMBER_SELECT =
  `${TOUCH} max-w-full rounded-poke-md border border-poke-border bg-poke-surface px-2 py-1 text-sm text-poke-text-primary ` +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus disabled:opacity-50';

/**
 * League groups editor (Participants tab of the admin league page; league groups design §7). Loads its data from
 * `GET /api/seasons/[id]/groups` (names, seeds and lock flags only) and writes through (`editor-requests.ts`):
 * - `PUT …/groups` — split by seed (serpentine) or remove every group (confirm dialog);
 * - `PATCH …/groups/[groupId]` — rename (inline form; Escape cancels, focus returns to the Rename button);
 * - `PATCH …/groups/members` — move a trainer, or place one who joined after the split.
 * The server refuses whatever the database guards refuse (a group with a live draft is frozen, SEASON_GROUP_LOCKED;
 * once a phase has a round every group is, SEASON_GROUPS_SCHEDULED; a group keeps two trainers, SEASON_GROUP_TOO_SMALL);
 * the editor greys those controls out in advance, says why, renders any refusal from its code and then re-reads its
 * data, so a lock that arrived meanwhile shows at once (`reloadAfter`).
 */
export default function LeagueGroupsEditor({ seasonId }: LeagueGroupsEditorProps) {
  const t = useT(leagueAdminGroupsMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsDraft);
  const [data, setData] = useState<LeagueGroupsEditorDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<EditorError | null>(null);
  const [status, setStatus] = useState<'saved' | null>(null);
  const [groupCount, setGroupCount] = useState(2);
  const [splitting, setSplitting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const countId = useId();

  /** Applies a load's answer (`editorLoadUpdate`). `keepError`: a reload after a refusal keeps the refusal on screen. */
  const applyLoad = useCallback((outcome: EditorLoadOutcome, keepError: boolean) => {
    const update = editorLoadUpdate(outcome, keepError);
    if (update.data !== undefined) setData(update.data);
    if (update.error !== undefined) setError(update.error);
    if (update.groupCount !== undefined) setGroupCount(update.groupCount);
    setLoading(false);
  }, []);

  /** Re-reads the DTO (Retry, and after a rename or a refusal). */
  const load = useCallback(
    async (keepError = false) => applyLoad(await loadEditor(fetch, seasonId), keepError),
    [applyLoad, seasonId],
  );

  // The first read: state changes only in the answer's callback (and not after unmount or a league change).
  useEffect(() => {
    let active = true;
    void loadEditor(fetch, seasonId).then((outcome) => {
      if (active) applyLoad(outcome, false);
    });
    return () => {
      active = false;
    };
  }, [applyLoad, seasonId]);

  /** Sends one write (`runEditorWrite`); applies the fresh DTO it answers, or re-reads it (rename, refusal). */
  async function write(request: EditorWrite): Promise<boolean> {
    return runEditorWrite(fetch, request, {
      begin: () => {
        setError(null);
        setStatus(null);
      },
      saved: (fresh) => {
        if (fresh) setData(fresh);
        setStatus('saved');
      },
      failed: setError,
      reload: load,
    });
  }

  async function split() {
    setSplitting(true);
    await write(splitWrite(seasonId, groupCount));
    setSplitting(false);
  }

  async function clear() {
    setClearing(true);
    const ok = await write(clearWrite(seasonId));
    setClearing(false);
    if (ok) setConfirmClear(false);
  }

  async function place(playerId: string, groupId: string) {
    setMoving(playerId);
    await write(placeWrite(seasonId, playerId, groupId));
    setMoving(null);
  }

  async function rename(groupId: string, name: string): Promise<boolean> {
    return write(renameWrite(seasonId, groupId, name));
  }

  if (loading && !data) {
    return (
      <p className="text-sm text-poke-text-muted" role="status">
        {t('editor.loading')}
      </p>
    );
  }

  const errorNode = error ? (
    <Alert variant="error">{'api' in error ? errorText(error.api) : t(`editor.errors.${error.key}`)}</Alert>
  ) : null;

  if (!data) {
    return (
      <div className="space-y-3">
        {errorNode}
        <Button
          variant="secondary"
          size="sm"
          className={TOUCH}
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          {t('editor.retry')}
        </Button>
      </div>
    );
  }

  return (
    <LeagueGroupsEditorView
      data={data}
      error={errorNode}
      saved={status === 'saved'}
      groupCount={groupCount}
      countId={countId}
      onGroupCount={setGroupCount}
      splitting={splitting}
      onSplit={() => void split()}
      confirmClear={confirmClear}
      onAskClear={() => setConfirmClear(true)}
      onCloseClear={() => setConfirmClear(false)}
      onClear={() => void clear()}
      clearing={clearing}
      moving={moving}
      onPlace={(playerId, groupId) => void place(playerId, groupId)}
      onRename={rename}
    />
  );
}

export interface LeagueGroupsEditorViewProps {
  data: LeagueGroupsEditorDTO;
  /** The rendered refusal or failure (an `Alert`), or null. */
  error: ReactNode;
  /** The last write succeeded (announced to screen readers). */
  saved: boolean;
  groupCount: number;
  countId: string;
  onGroupCount: (count: number) => void;
  splitting: boolean;
  onSplit: () => void;
  confirmClear: boolean;
  onAskClear: () => void;
  onCloseClear: () => void;
  onClear: () => void;
  clearing: boolean;
  /** The trainer whose move is in flight. */
  moving: string | null;
  onPlace: (playerId: string, groupId: string) => void;
  onRename: (groupId: string, name: string) => Promise<boolean>;
}

/** The editor's markup for loaded data (pure props; rendered by `LeagueGroupsEditor`, and by tests). */
export function LeagueGroupsEditorView({
  data,
  error,
  saved,
  groupCount,
  countId,
  onGroupCount,
  splitting,
  onSplit,
  confirmClear,
  onAskClear,
  onCloseClear,
  onClear,
  clearing,
  moving,
  onPlace,
  onRename,
}: LeagueGroupsEditorViewProps) {
  const t = useT(leagueAdminGroupsMessages);
  const locale = useLocale();
  const groups = data.groups;
  const nameOf = new Map(data.participants.map((p) => [p.id, p] as const));
  const placed = new Set(groups.flatMap((g) => g.player_ids));
  const unplaced = data.participants.filter((p) => !placed.has(p.id));
  const maxCount = Math.min(MAX_GROUPS, Math.floor(data.participants.length / MIN_GROUP_SIZE));
  const counts = Array.from({ length: Math.max(0, maxCount - 1) }, (_, i) => i + 2);
  const label = (g: LeagueGroupsEditorGroup) => translateEngineLabel('group', g.name, locale);
  const canSplit = !data.replaceLocked && counts.length > 0;

  return (
    <div className="space-y-4">
      <p className="sr-only" role="status" aria-live="polite">
        {saved ? t('editor.saved') : ''}
      </p>
      {error}
      {data.scheduleLocked ? (
        <Alert variant="warning">{t('editor.scheduleLocked')}</Alert>
      ) : data.replaceLocked ? (
        <Alert variant="warning">{t('editor.replaceLocked')}</Alert>
      ) : null}

      {canSplit ? (
        <div className="flex flex-wrap items-end gap-3">
          <Select
            id={countId}
            label={t('editor.groupCount')}
            value={String(groupCount)}
            onChange={(e) => onGroupCount(Number(e.target.value))}
            className={TOUCH}
            options={counts.map((n) => ({ value: String(n), label: t('editor.groupCountOption', { count: n }) }))}
          />
          <Button variant="secondary" size="sm" className={TOUCH} onClick={onSplit} loading={splitting}>
            {groups.length > 0 ? t('editor.resplit') : t('editor.serpentine')}
          </Button>
          {groups.length > 0 ? (
            <Button variant="ghost" size="sm" className={TOUCH} onClick={onAskClear}>
              {t('editor.clear')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {canSplit ? <p className="text-xs text-poke-text-muted">{t('editor.serpentineHint')}</p> : null}

      {groups.length === 0 ? (
        <p className="text-sm text-poke-text-muted">{t('editor.noGroups')}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              groups={groups}
              title={label(group)}
              labelOf={label}
              members={group.player_ids.map((id) => nameOf.get(id) ?? { id, name: id, seed: null })}
              moving={moving}
              scheduleLocked={data.scheduleLocked}
              onMove={onPlace}
              onRename={onRename}
            />
          ))}
        </div>
      )}

      {groups.length > 0 && unplaced.length > 0 ? (
        <Card variant="outlined" padding="sm" role="group" aria-labelledby="league-groups-unplaced">
          <h4 id="league-groups-unplaced" className="mb-1 font-heading text-sm font-semibold text-poke-text-primary">
            {t('editor.unplacedTitle')}
          </h4>
          <p className="mb-2 text-xs text-poke-text-muted">
            {data.scheduleLocked ? t('editor.unplacedLockedHint') : t('editor.unplacedHint')}
          </p>
          <ul className="space-y-2">
            {unplaced.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 break-words text-poke-text-primary">{p.name}</span>
                <select
                  className={MEMBER_SELECT}
                  value=""
                  disabled={data.scheduleLocked || moving === p.id}
                  onChange={(e) => {
                    if (e.target.value) onPlace(p.id, e.target.value);
                  }}
                  aria-label={t('editor.moveAria', { name: p.name })}
                >
                  <option value="">{t('editor.choose')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id} disabled={g.locked}>
                      {label(g)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmClear}
        onClose={onCloseClear}
        onConfirm={onClear}
        title={t('editor.clear')}
        message={t('editor.confirmClear')}
        confirmLabel={t('editor.clear')}
        loading={clearing}
      />
    </div>
  );
}

interface GroupCardProps {
  group: LeagueGroupsEditorGroup;
  groups: readonly LeagueGroupsEditorGroup[];
  title: string;
  labelOf: (g: LeagueGroupsEditorGroup) => string;
  members: readonly { id: string; name: string; seed: number | null }[];
  moving: string | null;
  /** A phase of the league has a round: every group is fixed (renames only). */
  scheduleLocked: boolean;
  onMove: (playerId: string, groupId: string) => void;
  onRename: (groupId: string, name: string) => Promise<boolean>;
}

function GroupCard({
  group,
  groups,
  title,
  labelOf,
  members,
  moving,
  scheduleLocked,
  onMove,
  onRename,
}: GroupCardProps) {
  const t = useT(leagueAdminGroupsMessages);
  const headingId = useId();
  const inputId = useId();
  const minSizeId = useId();
  // Nobody leaves a group at the minimum size (the database refuses it: SEASON_GROUP_TOO_SMALL).
  const atMinimum = !group.locked && groups.length > 1 && members.length <= MIN_GROUP_SIZE;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [saving, setSaving] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  function close() {
    setEditing(false);
    setName(group.name);
    // Focus returns to the control that opened the form.
    requestAnimationFrame(() => renameButton.current?.focus());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const ok = await onRename(group.id, name.trim());
    setSaving(false);
    if (ok) close();
  }

  return (
    <Card variant="muted" padding="sm" role="group" aria-labelledby={headingId}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="min-w-0 break-words font-heading text-sm font-semibold text-poke-text-primary">
          {title}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          {group.locked ? (
            <Badge variant="default" title={scheduleLocked ? t('editor.scheduledHint') : t('editor.lockedHint')}>
              {scheduleLocked ? t('editor.scheduledBadge') : t('editor.lockedBadge')}
              <span className="sr-only">
                {': '}
                {scheduleLocked ? t('editor.scheduledHint') : t('editor.lockedHint')}
              </span>
            </Badge>
          ) : null}
          <span className="text-xs text-poke-text-muted">{t('editor.members', { count: members.length })}</span>
          {!editing ? (
            <Button
              ref={renameButton}
              variant="ghost"
              size="sm"
              className={TOUCH}
              onClick={() => setEditing(true)}
              aria-label={t('editor.renameAria', { name: title })}
            >
              {t('editor.rename')}
            </Button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <form
          className="mb-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => void submit(e)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              ref={input}
              id={inputId}
              label={t('editor.renameLabel')}
              value={name}
              maxLength={60}
              required
              onChange={(e) => setName(e.target.value)}
              className={TOUCH}
            />
          </div>
          <Button type="submit" variant="primary" size="sm" className={TOUCH} loading={saving} disabled={!name.trim()}>
            {t('editor.save')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={close}>
            {t('editor.cancel')}
          </Button>
        </form>
      ) : null}

      {atMinimum && members.length > 0 ? (
        <p id={minSizeId} className="mb-2 text-xs text-poke-text-muted">
          {t('editor.minSizeHint', { min: MIN_GROUP_SIZE })}
        </p>
      ) : null}
      {members.length === 0 ? (
        <p className="text-xs text-poke-text-muted">{t('editor.noMembers')}</p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words text-poke-text-primary">
                {m.seed !== null ? (
                  <span className="mr-1 text-xs text-poke-text-muted">{t('editor.seed', { seed: m.seed })}</span>
                ) : null}
                {m.name}
              </span>
              <select
                className={MEMBER_SELECT}
                value={group.id}
                disabled={group.locked || atMinimum || moving === m.id}
                onChange={(e) => onMove(m.id, e.target.value)}
                aria-label={t('editor.moveAria', { name: m.name })}
                aria-describedby={atMinimum ? minSizeId : undefined}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id} disabled={g.id !== group.id && g.locked}>
                    {labelOf(g)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
