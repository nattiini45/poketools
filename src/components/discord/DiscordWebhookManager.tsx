'use client';

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Alert from '@/components/ui/Alert';
import SkewChip from '@/components/ui/SkewChip';
import AdminDialog from '@/components/admin/AdminDialog';
import AdminEmpty from '@/components/admin/AdminEmpty';
import { TOUCH } from '@/components/admin/admin-table';
import { CHOICE, CHOICE_OFF, CHOICE_ON } from '@/components/admin/match-styles';
import { cn } from '@/lib/utils/cn';
import type {
  DiscordWebhookView,
  WebhookScopeType,
  DiscordEventType,
  WebhookFormatOptions,
  WebhookLanguage,
} from '@/types/discord';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';
import { ENABLE_KALE_CABBAGE } from '@/lib/feature-flags';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsBroadcast } from '@/i18n/messages/errors/broadcast';
import { integrationsMessages } from '@/i18n/messages/integrations';
import { requestWebhookTest } from './webhook-test-client';

const ALL_EVENT_TYPES: readonly DiscordEventType[] = [
  'match_result_submitted',
  'match_confirmed',
  'match_disputed',
  'round_generated',
  'round_completed',
  'tournament_started',
  'tournament_completed',
  'season_advanced',
  'draft_pick_made',
  'draft_completed',
  'draft_turn_started',
  'draft_turn_reminder',
  'draft_slot_blocked',
  'draft_redraft_published',
  'round_recap_published',
  'round_forecast_published',
];

const KALE_CABBAGE_EVENTS: readonly DiscordEventType[] = ['round_recap_published', 'round_forecast_published'];
const EVENT_TYPES = ENABLE_KALE_CABBAGE
  ? ALL_EVENT_TYPES
  : ALL_EVENT_TYPES.filter((e) => !KALE_CABBAGE_EVENTS.includes(e));

const SCOPE_TYPES: readonly WebhookScopeType[] = ['global', 'season', 'tournament'];

/** The on/off options; `language` has its own select. */
type BooleanFormatKey = Exclude<keyof WebhookFormatOptions, 'language'>;
/** The on/off options this manager shows (the gamification toggles keep their defaults). */
type ShownFormatKey = Extract<
  BooleanFormatKey,
  'spoiler_results' | 'show_pokemon_details' | 'show_replay_link' | 'ping_next_drafter' | 'attach_match_card'
>;

const FORMAT_OPTION_KEYS: readonly ShownFormatKey[] = [
  'spoiler_results',
  'show_pokemon_details',
  'show_replay_link',
  'ping_next_drafter',
  'attach_match_card',
];

const WEBHOOK_LANGUAGES: readonly WebhookLanguage[] = ['league', 'de', 'en'];

/** A failed call: the API's error object, plus local text for when it carries none. */
interface ErrorState {
  res: ApiErrorLike;
  fallback: string;
}

export default function DiscordWebhookManager() {
  const t = useT(integrationsMessages);
  const errorText = useApiErrorText(errorsBroadcast);

  const [webhooks, setWebhooks] = useState<DiscordWebhookView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorState | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formScopeType, setFormScopeType] = useState<WebhookScopeType>('global');
  const [formScopeId, setFormScopeId] = useState('');
  const [formWebhookUrl, setFormWebhookUrl] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formEventFilter, setFormEventFilter] = useState<DiscordEventType[]>([]);
  const [formFormatOptions, setFormFormatOptions] = useState<WebhookFormatOptions>({ ...DEFAULT_FORMAT_OPTIONS });
  const [submitting, setSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEventFilter, setEditEventFilter] = useState<DiscordEventType[]>([]);
  const [editFormatOptions, setEditFormatOptions] = useState<WebhookFormatOptions>({ ...DEFAULT_FORMAT_OPTIONS });
  const [editSaving, setEditSaving] = useState(false);

  const fail = useCallback((e: unknown, fallback: string) => {
    setError({ res: toApiErrorLike(e), fallback });
  }, []);

  const eventLabel = (evt: DiscordEventType): string => {
    if (evt === 'round_recap_published' || evt === 'round_forecast_published') return t(`kaleEvents.${evt}`);
    return t(`events.${evt}`);
  };

  const scopeOptions = SCOPE_TYPES.map((value) => ({ value, label: t(`scopes.${value}`) }));
  const languageOptions = WEBHOOK_LANGUAGES.map((value) => ({ value, label: t(`discord.language.${value}`) }));

  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/discord-webhooks');
      const json = await res.json();
      if (!json.success) {
        fail(json, t('discord.errors.load'));
        return;
      }
      setWebhooks(json.data ?? []);
    } catch (err) {
      fail(err, t('discord.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [fail, t]);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const resetForm = () => {
    setFormWebhookUrl('');
    setFormLabel('');
    setFormScopeId('');
    setFormEventFilter([]);
    setFormFormatOptions({ ...DEFAULT_FORMAT_OPTIONS });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/discord-webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope_type: formScopeType,
          scope_id: formScopeType === 'global' ? null : formScopeId || null,
          webhook_url: formWebhookUrl,
          label: formLabel,
          event_filter: formEventFilter,
          format_options: formFormatOptions,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        fail(json, t('discord.errors.create'));
        return;
      }

      setShowForm(false);
      resetForm();
      await fetchWebhooks();
    } catch (err) {
      fail(err, t('discord.errors.create'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (webhook: DiscordWebhookView) => {
    try {
      const res = await fetch(`/api/discord-webhooks/${webhook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !webhook.enabled }),
      });
      const json = await res.json();
      if (!json.success) {
        fail(json, t('discord.errors.toggle'));
        return;
      }
      await fetchWebhooks();
    } catch (err) {
      fail(err, t('discord.errors.toggle'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('discord.deleteConfirm'))) return;
    try {
      const res = await fetch(`/api/discord-webhooks/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        fail(json, t('discord.errors.delete'));
        return;
      }
      await fetchWebhooks();
    } catch (err) {
      fail(err, t('discord.errors.delete'));
    }
  };

  const handleTest = async (webhook: DiscordWebhookView) => {
    // The server posts the test embed: the URL is never in the browser.
    try {
      const json = await requestWebhookTest(webhook.id);
      if (!json.success) {
        fail(json, t('discord.errors.test'));
        return;
      }
      alert(t('discord.testSent'));
    } catch (err) {
      fail(err, t('discord.errors.test'));
    }
  };

  const startEditing = (webhook: DiscordWebhookView) => {
    setEditingId(webhook.id);
    setEditEventFilter([...webhook.event_filter]);
    setEditFormatOptions({ ...webhook.format_options });
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async (id: string) => {
    setEditSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/discord-webhooks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_filter: editEventFilter,
          format_options: editFormatOptions,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        fail(json, t('discord.errors.update'));
        return;
      }
      setEditingId(null);
      await fetchWebhooks();
    } catch (err) {
      fail(err, t('discord.errors.update'));
    } finally {
      setEditSaving(false);
    }
  };

  const toggleEventFilter = (eventType: DiscordEventType) => {
    setFormEventFilter((prev) =>
      prev.includes(eventType)
        ? prev.filter((e) => e !== eventType)
        : [...prev, eventType]
    );
  };

  const toggleEditEventFilter = (eventType: DiscordEventType) => {
    setEditEventFilter((prev) =>
      prev.includes(eventType)
        ? prev.filter((e) => e !== eventType)
        : [...prev, eventType]
    );
  };

  const toggleFormatOption = (key: BooleanFormatKey) => {
    setFormFormatOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleEditFormatOption = (key: BooleanFormatKey) => {
    setEditFormatOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isWebhookLanguage = (v: string): v is WebhookLanguage =>
    (WEBHOOK_LANGUAGES as readonly string[]).includes(v);

  const errorMessage = error
    ? (error.res.error || error.res.code ? errorText(error.res) : error.fallback)
    : null;

  const renderLanguageSelect = (
    id: string,
    value: WebhookLanguage | undefined,
    onChange: (language: WebhookLanguage) => void,
  ) => (
    <div className="space-y-1">
      <Select
        id={id}
        label={t('discord.language.label')}
        value={value ?? 'league'}
        onChange={(e) => {
          if (isWebhookLanguage(e.target.value)) onChange(e.target.value);
        }}
        options={languageOptions}
      />
      <p className="text-caption text-fg-muted">{t('discord.language.hint')}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {errorMessage && (
        <Alert variant="error">{errorMessage}</Alert>
      )}

      {/* Action bar */}
      <div className="flex justify-end">
        <Button
          variant={showForm ? 'ghost' : 'primary'}
          size="sm" className={TOUCH}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? t('common.cancel') : t('discord.addWebhook')}
        </Button>
      </div>

      {/* Create form */}
      <AdminDialog open={showForm} onClose={() => setShowForm(false)} title={t('discord.newWebhook')} size="lg">
          <form onSubmit={handleCreate} className="space-y-4">

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                id="discord-webhook-scope"
                label={t('common.scope')}
                value={formScopeType}
                onChange={(e) => setFormScopeType(e.target.value as WebhookScopeType)}
                options={scopeOptions}
              />

              {formScopeType !== 'global' && (
                <Input
                  label={formScopeType === 'season' ? t('common.seasonId') : t('common.tournamentId')}
                  value={formScopeId}
                  onChange={(e) => setFormScopeId(e.target.value)}
                  placeholder={t('common.scopeIdPlaceholder')}
                  hint={t('discord.scopeIdHint')}
                />
              )}
            </div>

            <Input
              label={t('discord.webhookUrl')}
              value={formWebhookUrl}
              onChange={(e) => setFormWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              hint={t('discord.webhookUrlHint')}
            />

            <Input
              label={t('common.label')}
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder={t('discord.labelPlaceholder')}
              hint={t('discord.labelHint')}
            />

            {/* Event filter */}
            <div className="space-y-1.5">
              <label className="block text-caption font-medium text-fg">
                {t('common.eventFilter')}
              </label>
              <p className="mb-2 text-caption text-fg-muted">
                {t('common.eventFilterHint')}
              </p>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map((evt) => (
                  <button
                    key={evt}
                    type="button"
                    aria-pressed={formEventFilter.includes(evt)}
                    onClick={() => toggleEventFilter(evt)}
                    className={cn(CHOICE, formEventFilter.includes(evt) ? CHOICE_ON : CHOICE_OFF, 'text-caption')}
                  >
                    {eventLabel(evt)}
                  </button>
                ))}
              </div>
            </div>

            {/* Format options */}
            <div className="space-y-1.5">
              <label className="block text-caption font-medium text-fg">
                {t('discord.messageOptions')}
              </label>
              <div className="space-y-2 mt-2">
                {FORMAT_OPTION_KEYS.map((key) => (
                  <label key={key} className="flex items-start gap-2.5 min-h-11 cursor-pointer sm:min-h-0">
                    <input
                      type="checkbox"
                      checked={formFormatOptions[key]}
                      onChange={() => toggleFormatOption(key)}
                      className="mt-0.5 size-4 accent-[var(--accent-fill)]"
                    />
                    <div>
                      <span className="text-body text-fg">
                        {t(`discord.formatOptions.${key}.label`)}
                      </span>
                      <p className="text-caption text-fg-muted">{t(`discord.formatOptions.${key}.description`)}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {renderLanguageSelect('discord-webhook-language', formFormatOptions.language, (language) =>
              setFormFormatOptions((prev) => ({ ...prev, language })),
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-hairline pt-4">
              <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" className={TOUCH} loading={submitting}>
                {t('discord.createWebhook')}
              </Button>
            </div>
          </form>
      </AdminDialog>

      {/* Webhook list */}
      {loading ? (
        <p className="text-body text-fg-muted">{t('discord.loading')}</p>
      ) : webhooks.length === 0 ? (
        <AdminEmpty title={t('discord.empty')} icon="old-amber" />
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <div key={webhook.id} className="rounded-poke-lg border border-hairline bg-surface p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="min-w-0 break-words font-heading text-subtitle text-fg">
                      {webhook.label}
                    </h3>
                    <SkewChip tone={webhook.enabled ? 'win' : 'neutral'}>
                      {webhook.enabled ? t('common.active') : t('common.disabled')}
                    </SkewChip>
                    <SkewChip tone="accent">
                      {webhook.scope_type === 'global'
                        ? t('common.global')
                        : webhook.scope_id
                          ? `${t(`scopes.${webhook.scope_type}`)}: ${webhook.scope_id.slice(0, 8)}…`
                          : t(`scopes.${webhook.scope_type}`)}
                    </SkewChip>
                    <SkewChip>
                      {t('discord.language.badge', {
                        language: t(`discord.language.${webhook.format_options.language ?? 'league'}`),
                      })}
                    </SkewChip>
                  </div>
                  <p className="break-all text-caption text-fg-muted">
                    {t('discord.webhookUrlSaved', { hint: webhook.webhook_url_hint })}
                  </p>

                  {/* Event filter tags */}
                  {webhook.event_filter.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {webhook.event_filter.map((evt) => (
                        <span
                          key={evt}
                          className="rounded-poke-sm border border-hairline bg-elevated px-1.5 py-0.5 text-caption text-fg-muted"
                        >
                          {ALL_EVENT_TYPES.includes(evt) ? eventLabel(evt) : evt}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Format option indicators */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {FORMAT_OPTION_KEYS.map((key) => (
                      <span
                        key={key}
                        className={cn(
                          'rounded-poke-sm border px-1.5 py-0.5 text-caption',
                          webhook.format_options[key] ? 'border-hairline bg-win-bg text-win' : 'border-hairline bg-surface text-fg-muted line-through',
                        )}
                      >
                        {t(`discord.formatOptions.${key}.label`)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 md:shrink-0">
                  <Button
                    variant="ghost"
                    size="sm" className={TOUCH}
                    onClick={() => handleTest(webhook)}
                  >
                    {t('common.test')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm" className={TOUCH}
                    onClick={() => startEditing(webhook)}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant={webhook.enabled ? 'secondary' : 'success'}
                    size="sm" className={TOUCH}
                    onClick={() => handleToggle(webhook)}
                  >
                    {webhook.enabled ? t('common.disable') : t('common.enable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm" className={TOUCH}
                    onClick={() => handleDelete(webhook.id)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>

            </div>
          ))}
        </div>
      )}

      <AdminDialog
        open={editingId !== null}
        onClose={cancelEditing}
        title={webhooks.find((w) => w.id === editingId)?.label ?? ''}
        size="lg"
      >
        {editingId && (
          <div className="space-y-4">
                  {/* Event filter */}
                <div className="space-y-1.5">
                  <label className="block text-caption font-medium text-fg">
                    {t('common.eventFilter')}
                  </label>
                  <p className="mb-2 text-caption text-fg-muted">
                    {t('common.eventFilterHint')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {EVENT_TYPES.map((evt) => (
                      <button
                        key={evt}
                        type="button"
                        aria-pressed={editEventFilter.includes(evt)}
                        onClick={() => toggleEditEventFilter(evt)}
                        className={cn(CHOICE, editEventFilter.includes(evt) ? CHOICE_ON : CHOICE_OFF, 'text-caption')}
                      >
                        {eventLabel(evt)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Format options */}
                <div className="space-y-1.5">
                  <label className="block text-caption font-medium text-fg">
                    {t('discord.messageOptions')}
                  </label>
                  <div className="space-y-2 mt-2">
                    {FORMAT_OPTION_KEYS.map((key) => (
                      <label key={key} className="flex items-start gap-2.5 min-h-11 cursor-pointer sm:min-h-0">
                        <input
                          type="checkbox"
                          checked={editFormatOptions[key]}
                          onChange={() => toggleEditFormatOption(key)}
                          className="mt-0.5 size-4 accent-[var(--accent-fill)]"
                        />
                        <div>
                          <span className="text-body text-fg">
                            {t(`discord.formatOptions.${key}.label`)}
                          </span>
                          <p className="text-caption text-fg-muted">{t(`discord.formatOptions.${key}.description`)}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {renderLanguageSelect(`discord-webhook-language-${editingId}`, editFormatOptions.language, (language) =>
                  setEditFormatOptions((prev) => ({ ...prev, language })),
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" className={TOUCH} onClick={cancelEditing}>
                    {t('common.cancel')}
                  </Button>
                  <Button size="sm" className={TOUCH} loading={editSaving} onClick={() => handleSaveEdit(editingId)}>
                    {t('discord.saveChanges')}
                  </Button>
                </div>

          </div>
        )}
      </AdminDialog>
    </div>
  );
}
