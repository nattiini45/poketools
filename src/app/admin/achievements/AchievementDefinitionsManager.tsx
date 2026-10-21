'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiResult } from '@/types/api';
import type {
  AchievementCategory,
  AchievementCriteria,
  AchievementDefinition,
  AchievementTier,
} from '@/types/achievement';
import Table, { type Column } from '@/components/ui/Table';
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
  title,
  form,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
  catalogHint,
}: {
  title: string;
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
    <section className="bg-poke-elevated border border-poke-border rounded-poke-lg p-4 space-y-3">
      <h3 className="text-sm font-heading font-bold text-poke-text-primary">{title}</h3>
      <p className="text-xs text-poke-text-tertiary">{t('achievements.catalogNote')}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block text-poke-text-secondary mb-1">{t('achievements.form.key')}</span>
          <input
            value={form.key}
            onChange={(event) => onChange({ key: event.target.value })}
            className="w-full px-3 py-2 border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
          />
        </label>

        <label className="text-sm">
          <span className="block text-poke-text-secondary mb-1">{t('achievements.form.name')}</span>
          <input
            value={form.name}
            onChange={(event) => onChange({ name: event.target.value })}
            className="w-full px-3 py-2 border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
          />
          {catalogHint && (
            <span className="block mt-1 text-xs text-poke-text-tertiary">
              {t('achievements.catalogHint', { name: catalogHint })}
            </span>
          )}
        </label>

        <label className="text-sm md:col-span-2">
          <span className="block text-poke-text-secondary mb-1">{t('achievements.form.description')}</span>
          <input
            value={form.description}
            onChange={(event) => onChange({ description: event.target.value })}
            className="w-full px-3 py-2 border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
          />
        </label>

        <label className="text-sm">
          <span className="block text-poke-text-secondary mb-1">{t('achievements.form.icon')}</span>
          <input
            value={form.icon}
            onChange={(event) => onChange({ icon: event.target.value })}
            className="w-full px-3 py-2 border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
          />
        </label>

        <label className="text-sm">
          <span className="block text-poke-text-secondary mb-1">{t('achievements.form.category')}</span>
          <select
            value={form.category}
            onChange={(event) => onChange({ category: event.target.value as AchievementCategory })}
            className="w-full px-3 py-2 border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(`achievements.categories.${option}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-poke-text-secondary mb-1">{t('achievements.form.tier')}</span>
          <select
            value={form.tier}
            onChange={(event) => onChange({ tier: event.target.value as AchievementTier })}
            className="w-full px-3 py-2 border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
          >
            {TIER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(`achievements.tiers.${option}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-poke-text-secondary">
          <input
            type="checkbox"
            checked={form.repeatable}
            onChange={(event) => onChange({ repeatable: event.target.checked })}
          />
          {t('achievements.form.repeatable')}
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-poke-text-secondary">
          <input
            type="checkbox"
            checked={form.hidden}
            onChange={(event) => onChange({ hidden: event.target.checked })}
          />
          {t('achievements.form.hidden')}
        </label>

        <label className="text-sm md:col-span-2">
          <span className="block text-poke-text-secondary mb-1">{t('achievements.form.criteria')}</span>
          <textarea
            value={form.criteriaJson}
            onChange={(event) => onChange({ criteriaJson: event.target.value })}
            rows={8}
            className="w-full px-3 py-2 border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary font-mono text-xs"
          />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="px-3 py-2 bg-poke-accent text-poke-surface rounded-poke-md text-sm font-semibold disabled:opacity-60"
        >
          {busy ? t('achievements.form.saving') : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 border border-poke-border text-poke-text-secondary rounded-poke-md text-sm font-semibold"
          >
            {tc('actions.cancel')}
          </button>
        )}
      </div>
    </section>
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

  const definitionColumns = useMemo((): Column<AchievementDefinition>[] => [
    {
      key: 'key',
      header: t('achievements.list.columns.key'),
      sortable: true,
      sortValue: (d) => d.key,
      render: (definition) => (
        <span className="font-mono text-xs text-poke-text-primary">{definition.key}</span>
      ),
    },
    {
      key: 'name',
      header: t('achievements.list.columns.name'),
      sortable: true,
      sortValue: (d) => d.name,
      render: (definition) => {
        const hint = catalogName(definition);
        return (
          <span className="text-poke-text-primary">
            {definition.name}
            {hint && (
              <span className="block text-xs text-poke-text-tertiary">
                {t('achievements.catalogHint', { name: hint })}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'tier',
      header: t('achievements.list.columns.tier'),
      sortable: true,
      sortValue: (d) => d.tier,
      render: (definition) => (
        <span className="text-poke-text-secondary">
          {t.dynamic(`achievements.tiers.${definition.tier}`, undefined, definition.tier)}
        </span>
      ),
    },
    {
      key: 'category',
      header: t('achievements.list.columns.category'),
      sortable: true,
      sortValue: (d) => d.category,
      render: (definition) => (
        <span className="text-poke-text-secondary">
          {t.dynamic(`achievements.categories.${definition.category}`, undefined, definition.category)}
        </span>
      ),
    },
    {
      key: 'criteria',
      header: t('achievements.list.columns.criteria'),
      render: (definition) => (
        <code className="text-[11px] text-poke-text-tertiary">
          {JSON.stringify(definition.criteria).slice(0, 100)}
          {JSON.stringify(definition.criteria).length > 100 ? '…' : ''}
        </code>
      ),
    },
    {
      key: 'actions',
      header: t('achievements.list.columns.actions'),
      render: (definition) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleStartEdit(definition)}
            className="px-2 py-1 text-xs border border-poke-border rounded-poke-md text-poke-text-secondary"
          >
            {tc('actions.edit')}
          </button>
          <button
            type="button"
            onClick={() => void handleDelete(definition)}
            className="px-2 py-1 text-xs border border-red-300 rounded-poke-md text-red-600"
          >
            {tc('actions.delete')}
          </button>
        </div>
      ),
    },
  ], [handleStartEdit, handleDelete, catalogName, t, tc]);

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

  return (
    <div className="space-y-6">
      {errorText && (
        <div className="border border-red-300 bg-red-50 text-red-700 rounded-poke-md px-3 py-2 text-sm">
          {errorText}
        </div>
      )}

      <DefinitionForm
        title={t('achievements.form.createTitle')}
        form={createForm}
        onChange={(patch) => setCreateForm((prev) => ({ ...prev, ...patch }))}
        onSubmit={() => void handleCreate()}
        submitLabel={t('achievements.form.create')}
        busy={busy}
      />

      <section className="bg-poke-surface border border-poke-border rounded-poke-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-poke-border">
          <h3 className="text-sm font-heading font-bold text-poke-text-primary">{t('achievements.list.title')}</h3>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-sm text-poke-text-tertiary">{t('achievements.list.loading')}</p>
        ) : definitions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-poke-text-tertiary">{t('achievements.list.empty')}</p>
        ) : (
          <div className="p-4">
            <Table
              columns={definitionColumns}
              data={definitions}
              keyExtractor={(definition) => definition.id}
              emptyMessage={t('achievements.list.emptyTable')}
              defaultSort={{ key: 'key', direction: 'asc' }}
            />
          </div>
        )}
      </section>

      {editingId && (
        <DefinitionForm
          title={t('achievements.form.editTitle')}
          form={editForm}
          onChange={(patch) => setEditForm((prev) => ({ ...prev, ...patch }))}
          onSubmit={() => void handleSaveEdit()}
          onCancel={() => {
            setEditingId(null);
            setEditForm(EMPTY_FORM);
          }}
          submitLabel={t('achievements.form.saveChanges')}
          busy={busy}
          catalogHint={editingDefinition ? catalogName(editingDefinition) : null}
        />
      )}
    </div>
  );
}
