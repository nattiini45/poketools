'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiResult } from '@/types/api';
import type {
  AchievementCategory,
  AchievementCriteria,
  AchievementDefinition,
  AchievementTier,
} from '@/types/achievement';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Section from '@/components/ui/Section';
import Select from '@/components/ui/Select';
import SkewChip from '@/components/ui/SkewChip';
import Textarea from '@/components/ui/Textarea';
import AdminDialog from '@/components/admin/AdminDialog';
import AdminEmpty from '@/components/admin/AdminEmpty';
import AdminSectionHeading from '@/components/admin/AdminSectionHeading';
import { SortHeadButton, ariaSort } from '@/components/admin/SortIcon';
import { TablePagination } from '@/components/ui/Table';
import { useClientTable } from '@/lib/ui/use-client-table';
import { CELL, NAME_CELL, ROW, TABLE, TABLE_FRAME, TBODY, TH, THEAD, TOUCH } from '@/components/admin/admin-table';
import { DANGER_OUTLINE } from '@/components/admin/match-styles';
import { cn } from '@/lib/utils/cn';
import { useLocale, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { achievementText } from '@/i18n/content/achievements';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import { commonMessages } from '@/i18n/messages/common';

type DefinitionFormState = {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  tier: AchievementTier;
  repeatable: boolean;
  hidden: boolean;
  criteriaJson: string;
};

const CATEGORY_OPTIONS: AchievementCategory[] = ['combat', 'milestone', 'social', 'rare', 'meta'];
const TIER_OPTIONS: AchievementTier[] = ['bronze', 'silver', 'gold', 'platinum'];

const EMPTY_FORM: DefinitionFormState = {
  key: '',
  name: '',
  description: '',
  icon: '',
  category: 'combat',
  tier: 'bronze',
  repeatable: false,
  hidden: false,
  criteriaJson: '{\n  "type": "cumulative",\n  "stat": "total_wins",\n  "op": "gte",\n  "value": 10\n}',
};

function toForm(definition: AchievementDefinition): DefinitionFormState {
  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    icon: definition.icon ?? '',
    category: definition.category,
    tier: definition.tier,
    repeatable: definition.repeatable,
    hidden: definition.hidden,
    criteriaJson: JSON.stringify(definition.criteria, null, 2),
  };
}

function parseCriteria(criteriaJson: string): AchievementCriteria | null {
  try {
    const parsed = JSON.parse(criteriaJson) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as AchievementCriteria;
  } catch {
    return null;
  }
}

function buildPayload(form: DefinitionFormState): {
  key: string;
  name: string;
  description: string;
  icon: string | null;
  category: AchievementCategory;
  tier: AchievementTier;
  repeatable: boolean;
  hidden: boolean;
  criteria: AchievementCriteria;
} | null {
  const key = form.key.trim();
  const name = form.name.trim();
  const description = form.description.trim();
  if (!key || !name || !description) {
    return null;
  }

  const parsedCriteria = parseCriteria(form.criteriaJson);
  if (!parsedCriteria) {
    return null;
  }

  return {
    key,
    name,
    description,
    icon: form.icon.trim() ? form.icon.trim() : null,
    category: form.category,
    tier: form.tier,
    repeatable: form.repeatable,
    hidden: form.hidden,
    criteria: parsedCriteria,
  };
}

/** A failed request: the API body (`error` / `code` / `params`) or, for a non-OK success body, the HTTP status. */
class AchievementRequestError extends Error {
  constructor(
    readonly apiError: ApiErrorLike | null,
    readonly status: number,
  ) {
    super(apiError?.error ?? `Request failed (${status})`);
    this.name = 'AchievementRequestError';
  }
}

async function parseApiResult<T>(response: Response): Promise<T> {
  const json = (await response.json()) as ApiResult<T>;
  if (!response.ok || !json.success) {
    throw new AchievementRequestError(!json.success ? toApiErrorLike(json) : null, response.status);
  }
  return json.data;
}

/** Message keys an error can fall back to (no placeholders). */
type ErrorKey =
  | 'achievements.errors.invalidCreate'
  | 'achievements.errors.invalidEdit'
  | 'achievements.errors.loadFailed'
  | 'achievements.errors.createFailed'
  | 'achievements.errors.updateFailed'
  | 'achievements.errors.deleteFailed';

/** An error, translated at render (never stored as text). */
type ManagerError =
  | { local: ErrorKey }
  | { api: ApiErrorLike; fallback: ErrorKey }
  | { status: number };

/** Turns whatever a request threw into a `ManagerError`; `fallback` when nothing usable came back. */
function toManagerError(e: unknown, fallback: ErrorKey): ManagerError {
  if (e instanceof AchievementRequestError) {
    return e.apiError ? { api: e.apiError, fallback } : { status: e.status };
  }
  if (e instanceof TypeError) return { api: toApiErrorLike(e), fallback };
  return { local: fallback };
}

function DefinitionForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
  catalogHint,
}: {
  form: DefinitionFormState;
  onChange: (patch: Partial<DefinitionFormState>) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel: string;
  busy: boolean;
  /** The text players see for a catalogued achievement, when it differs from the stored name. */
  catalogHint?: string | null;
}) {
  const t = useT(adminToolsMessages);
  const tc = useT(commonMessages);
  return (
    <div className="space-y-4">
      <p className="text-caption text-fg-muted">{t('achievements.catalogNote')}</p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Input label={t('achievements.form.key')} value={form.key} onChange={(event) => onChange({ key: event.target.value })} />
        <Input
          label={t('achievements.form.name')}
          value={form.name}
          onChange={(event) => onChange({ name: event.target.value })}
          hint={catalogHint ? t('achievements.catalogHint', { name: catalogHint }) : undefined}
        />
        <div className="md:col-span-2">
          <Input
            label={t('achievements.form.description')}
            value={form.description}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </div>
        <Input label={t('achievements.form.icon')} value={form.icon} onChange={(event) => onChange({ icon: event.target.value })} />
        <Select
          label={t('achievements.form.category')}
          value={form.category}
          onChange={(event) => onChange({ category: event.target.value as AchievementCategory })}
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`achievements.categories.${option}`)}
            </option>
          ))}
        </Select>
        <Select label={t('achievements.form.tier')} value={form.tier} onChange={(event) => onChange({ tier: event.target.value as AchievementTier })}>
          {TIER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`achievements.tiers.${option}`)}
            </option>
          ))}
        </Select>
        <div className="flex flex-col justify-end gap-1">
          <label className="flex min-h-11 items-center gap-2 text-body text-fg sm:min-h-9">
            <input
              type="checkbox"
              checked={form.repeatable}
              onChange={(event) => onChange({ repeatable: event.target.checked })}
              className="size-4 accent-[var(--accent-fill)]"
            />
            {t('achievements.form.repeatable')}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-body text-fg sm:min-h-9">
            <input
              type="checkbox"
              checked={form.hidden}
              onChange={(event) => onChange({ hidden: event.target.checked })}
              className="size-4 accent-[var(--accent-fill)]"
            />
            {t('achievements.form.hidden')}
          </label>
        </div>
        <div className="md:col-span-2">
          <Textarea
            label={t('achievements.form.criteria')}
            value={form.criteriaJson}
            onChange={(event) => onChange({ criteriaJson: event.target.value })}
            rows={8}
            className="font-mono text-caption"
          />
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-3 border-t border-hairline pt-4">
        {onCancel && (
          <Button variant="ghost" className={TOUCH} onClick={onCancel}>
            {tc('actions.cancel')}
          </Button>
        )}
        <Button variant="primary" className={TOUCH} onClick={onSubmit} disabled={busy}>
          {busy ? t('achievements.form.saving') : submitLabel}
        </Button>
      </div>
    </div>
  );
}

export default function AchievementDefinitionsManager() {
  const t = useT(adminToolsMessages);
  const tc = useT(commonMessages);
  const locale = useLocale();
  const apiErrorText = useApiErrorText(errorsAdmin);

  const [definitions, setDefinitions] = useState<AchievementDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ManagerError | null>(null);
  const [busy, setBusy] = useState(false);

  const [createForm, setCreateForm] = useState<DefinitionFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DefinitionFormState>(EMPTY_FORM);

  const loadDefinitions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/achievements', { cache: 'no-store' });
      const data = await parseApiResult<AchievementDefinition[]>(response);
      setDefinitions(data);
    } catch (loadError) {
      setError(toManagerError(loadError, 'achievements.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDefinitions();
  }, [loadDefinitions]);

  const handleCreate = useCallback(async () => {
    const payload = buildPayload(createForm);
    if (!payload) {
      setError({ local: 'achievements.errors.invalidCreate' });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/achievements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await parseApiResult<AchievementDefinition>(response);
      setCreateForm(EMPTY_FORM);
      await loadDefinitions();
    } catch (saveError) {
      setError(toManagerError(saveError, 'achievements.errors.createFailed'));
    } finally {
      setBusy(false);
    }
  }, [createForm, loadDefinitions]);

  const handleStartEdit = useCallback((definition: AchievementDefinition) => {
    setEditingId(definition.id);
    setEditForm(toForm(definition));
    setError(null);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;

    const payload = buildPayload(editForm);
    if (!payload) {
      setError({ local: 'achievements.errors.invalidEdit' });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/achievements/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await parseApiResult<AchievementDefinition>(response);
      setEditingId(null);
      setEditForm(EMPTY_FORM);
      await loadDefinitions();
    } catch (saveError) {
      setError(toManagerError(saveError, 'achievements.errors.updateFailed'));
    } finally {
      setBusy(false);
    }
  }, [editForm, editingId, loadDefinitions]);

  const handleDelete = useCallback(async (definition: AchievementDefinition) => {
    const shouldDelete = window.confirm(t('achievements.confirmDelete', { key: definition.key }));
    if (!shouldDelete) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/achievements/${definition.id}`, {
        method: 'DELETE',
      });
      await parseApiResult<null>(response);
      await loadDefinitions();
    } catch (deleteError) {
      setError(toManagerError(deleteError, 'achievements.errors.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }, [loadDefinitions, t]);

  /** The catalog name players see, when the translation catalog overrides the stored name. */
  const catalogName = useCallback(
    (definition: Pick<AchievementDefinition, 'key' | 'name' | 'description'>): string | null => {
      const shown = achievementText(definition, locale).name;
      return shown !== definition.name ? shown : null;
    },
    [locale],
  );

  const sortConfigs = useMemo(
    () => [
      { key: 'key', accessor: (d: AchievementDefinition) => d.key },
      { key: 'name', accessor: (d: AchievementDefinition) => d.name },
      { key: 'tier', accessor: (d: AchievementDefinition) => d.tier },
      { key: 'category', accessor: (d: AchievementDefinition) => d.category },
    ],
    [],
  );
  const table = useClientTable(definitions, sortConfigs, { key: 'key', direction: 'asc' });
  const { sort } = table;
  const sortableColumns: { key: string; header: string }[] = [
    { key: 'key', header: t('achievements.list.columns.key') },
    { key: 'name', header: t('achievements.list.columns.name') },
    { key: 'tier', header: t('achievements.list.columns.tier') },
    { key: 'category', header: t('achievements.list.columns.category') },
  ];

  const errorText =
    error === null
      ? null
      : 'local' in error
        ? t(error.local)
        : 'status' in error
          ? t('achievements.errors.requestFailed', { status: error.status })
          : error.api.error || error.api.code
            ? apiErrorText(error.api)
            : t(error.fallback);

  const editingDefinition = editingId ? definitions.find((d) => d.id === editingId) : undefined;

  const errorBox = errorText && (
    <Alert variant="error" className="mb-4">
      {errorText}
    </Alert>
  );
  const closeEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  return (
    <div className="space-y-8">
      {!editingId && errorBox}

      <section aria-labelledby="achievements-list-title" aria-busy={loading}>
        <AdminSectionHeading
          id="achievements-list-title"
          icon="old-amber"
          title={t('achievements.list.title')}
          aside={!loading && <SkewChip>{definitions.length}</SkewChip>}
        />
        {loading ? (
          <p className="text-body text-fg-muted">{t('achievements.list.loading')}</p>
        ) : definitions.length === 0 ? (
          <AdminEmpty title={t('achievements.list.empty')} icon="old-amber" />
        ) : (
          <div className={TABLE_FRAME}>
            <table className={TABLE}>
              <caption className="sr-only">{t('achievements.list.title')}</caption>
              <thead className={THEAD}>
                <tr>
                  {sortableColumns.map((column) => (
                    <th key={column.key} scope="col" className={TH} aria-sort={ariaSort(sort, column.key)}>
                      <SortHeadButton
                        label={column.header}
                        active={sort?.key === column.key}
                        direction={sort?.key === column.key ? sort.direction : null}
                        onClick={() => table.handleSort(column.key)}
                      />
                    </th>
                  ))}
                  <th scope="col" className={TH}>{t('achievements.list.columns.criteria')}</th>
                  <th scope="col" className={cn(TH, 'xl:text-right')}>{t('achievements.list.columns.actions')}</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {table.pageRows.map((definition) => {
                  const hint = catalogName(definition);
                  return (
                    <tr key={definition.id} className={ROW}>
                      <td className={NAME_CELL}>
                        <span className="break-all font-mono text-caption text-fg">{definition.key}</span>
                      </td>
                      <td data-label={t('achievements.list.columns.name')} className={CELL}>
                        <span className="min-w-0 break-words text-fg">
                          {definition.name}
                          {hint && <span className="block text-caption text-fg-muted">{t('achievements.catalogHint', { name: hint })}</span>}
                        </span>
                      </td>
                      <td data-label={t('achievements.list.columns.tier')} className={CELL}>
                        <span className="text-fg">
                          {t.dynamic(`achievements.tiers.${definition.tier}`, undefined, definition.tier)}
                        </span>
                      </td>
                      <td data-label={t('achievements.list.columns.category')} className={CELL}>
                        <span className="text-fg">
                          {t.dynamic(`achievements.categories.${definition.category}`, undefined, definition.category)}
                        </span>
                      </td>
                      <td data-label={t('achievements.list.columns.criteria')} className={CELL}>
                        <code className="min-w-0 break-all font-mono text-caption text-fg-muted">{JSON.stringify(definition.criteria)}</code>
                      </td>
                      <td className="block max-xl:col-span-2 max-xl:border-t max-xl:border-hairline max-xl:pt-2 xl:table-cell xl:px-3 xl:py-3 xl:align-top">
                        <div className="flex flex-wrap gap-2 xl:justify-end">
                          <Button size="sm" variant="secondary" className={TOUCH} onClick={() => handleStartEdit(definition)}>
                            {tc('actions.edit')}
                          </Button>
                          <Button size="sm" variant="secondary" className={cn(DANGER_OUTLINE, TOUCH)} onClick={() => void handleDelete(definition)}>
                            {tc('actions.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TablePagination
              className="border-t border-hairline px-3 py-3"
              page={table.page}
              totalPages={table.totalPages}
              perPage={table.perPage}
              totalItems={table.totalItems}
              onPageChange={table.setPage}
              onPerPageChange={table.handlePerPageChange}
            />
          </div>
        )}
      </section>

      <Section icon="scope-lens" title={t('achievements.form.createTitle')}>
        <DefinitionForm
          form={createForm}
          onChange={(patch) => setCreateForm((prev) => ({ ...prev, ...patch }))}
          onSubmit={() => void handleCreate()}
          submitLabel={t('achievements.form.create')}
          busy={busy}
        />
      </Section>

      <AdminDialog open={editingId !== null} onClose={() => !busy && closeEdit()} title={t('achievements.form.editTitle')} size="lg">
        {errorBox}
        <DefinitionForm
          form={editForm}
          onChange={(patch) => setEditForm((prev) => ({ ...prev, ...patch }))}
          onSubmit={() => void handleSaveEdit()}
          onCancel={closeEdit}
          submitLabel={t('achievements.form.saveChanges')}
          busy={busy}
          catalogHint={editingDefinition ? catalogName(editingDefinition) : null}
        />
      </AdminDialog>
    </div>
  );
}
