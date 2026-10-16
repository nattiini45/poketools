'use client';

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import type {
  DiscordWebhook,
  WebhookScopeType,
  DiscordEventType,
  WebhookFormatOptions,
  WebhookLanguage,
} from '@/types/discord';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';
import { ENABLE_KALE_CABBAGE } from '@/lib/feature-flags';
import { useLocale, useT } from '@/i18n/client';
import { createTranslator } from '@/i18n/core';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsBroadcast } from '@/i18n/messages/errors/broadcast';
import { integrationsMessages } from '@/i18n/messages/integrations';

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
  const locale = useLocale();
  const errorText = useApiErrorText(errorsBroadcast);

  const [webhooks, setWebhooks] = useState<DiscordWebhook[]>([]);
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

  const handleToggle = async (webhook: DiscordWebhook) => {
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

  const handleTest = async (webhook: DiscordWebhook) => {
    // The test embed uses the webhook's forced language; one that follows the
    // league is tested in the admin's own language (the league's is not known here).
    const forced = webhook.format_options.language;
    const testT = createTranslator(integrationsMessages, forced === 'de' || forced === 'en' ? forced : locale);
    try {
      const res = await fetch(webhook.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: testT('discord.testEmbed.title'),
            description: testT('discord.testEmbed.description', { label: webhook.label }),
            color: 0x5865f2,
            timestamp: new Date().toISOString(),
          }],
        }),
      });
      if (!res.ok) {
        fail(t('discord.testStatus', { status: String(res.status) }), t('discord.errors.test'));
        return;
      }
      alert(t('discord.testSent'));
    } catch (err) {
      fail(err, t('discord.errors.test'));
    }
  };

  const startEditing = (webhook: DiscordWebhook) => {
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
      <p className="text-xs text-poke-text-muted">{t('discord.language.hint')}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-poke-md text-sm text-poke-danger-tint-ink">
          {errorMessage}
        </div>
      )}

      {/* Action bar */}
      <div className="flex justify-end">
        <Button
          variant={showForm ? 'ghost' : 'primary'}
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? t('common.cancel') : t('discord.addWebhook')}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            <h3 className="font-heading font-semibold text-poke-text-primary">
              {t('discord.newWebhook')}
            </h3>

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
              <label className="block text-sm font-heading font-semibold text-poke-text-primary">
                {t('common.eventFilter')}
              </label>
              <p className="text-xs text-poke-text-muted mb-2">
                {t('common.eventFilterHint')}
              </p>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map((evt) => (
                  <button
                    key={evt}
                    type="button"
                    aria-pressed={formEventFilter.includes(evt)}
                    onClick={() => toggleEventFilter(evt)}
                    className={`
                      px-2.5 py-1 text-xs rounded-full border transition-colors
                      ${
                        formEventFilter.includes(evt)
                          ? 'bg-poke-primary/20 border-poke-primary text-poke-primary'
                          : 'bg-poke-surface border-poke-border text-poke-text-secondary hover:border-poke-border-hover'
                      }
                    `}
                  >
                    {eventLabel(evt)}
                  </button>
                ))}
              </div>
            </div>

            {/* Format options */}
            <div className="space-y-1.5">
              <label className="block text-sm font-heading font-semibold text-poke-text-primary">
                {t('discord.messageOptions')}
              </label>
              <div className="space-y-2 mt-2">
                {FORMAT_OPTION_KEYS.map((key) => (
                  <label key={key} className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={formFormatOptions[key]}
                      onChange={() => toggleFormatOption(key)}
                      className="mt-0.5 rounded border-poke-border bg-poke-surface text-poke-primary focus:ring-poke-primary/50"
                    />
                    <div>
                      <span className="text-sm text-poke-text-primary group-hover:text-poke-text-primary/80">
                        {t(`discord.formatOptions.${key}.label`)}
                      </span>
                      <p className="text-xs text-poke-text-muted">{t(`discord.formatOptions.${key}.description`)}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {renderLanguageSelect('discord-webhook-language', formFormatOptions.language, (language) =>
              setFormFormatOptions((prev) => ({ ...prev, language })),
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" loading={submitting}>
                {t('discord.createWebhook')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Webhook list */}
      {loading ? (
        <p className="text-sm text-poke-text-muted">{t('discord.loading')}</p>
      ) : webhooks.length === 0 ? (
        <Card>
          <p className="text-center text-poke-text-secondary py-4">
            {t('discord.empty')}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <Card key={webhook.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-heading font-semibold text-poke-text-primary truncate">
                      {webhook.label}
                    </h3>
                    <Badge variant={webhook.enabled ? 'green' : 'default'}>
                      {webhook.enabled ? t('common.active') : t('common.disabled')}
                    </Badge>
                    <Badge variant="blue">
                      {webhook.scope_type === 'global'
                        ? t('common.global')
                        : webhook.scope_id
                          ? `${t(`scopes.${webhook.scope_type}`)}: ${webhook.scope_id.slice(0, 8)}…`
                          : t(`scopes.${webhook.scope_type}`)}
                    </Badge>
                    <Badge variant="default">
                      {t('discord.language.badge', {
                        language: t(`discord.language.${webhook.format_options.language ?? 'league'}`),
                      })}
                    </Badge>
                  </div>
                  <p className="text-xs text-poke-text-muted truncate">
                    {webhook.webhook_url.replace(/\/api\/webhooks\/\d+\/(.{8}).+/, '/api/webhooks/***/$1...')}
                  </p>

                  {/* Event filter tags */}
                  {webhook.event_filter.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {webhook.event_filter.map((evt) => (
                        <span
                          key={evt}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-poke-surface border border-poke-border text-poke-text-secondary"
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
                        className={`px-1.5 py-0.5 text-[10px] rounded ${
                          webhook.format_options[key]
                            ? 'bg-poke-primary/10 text-poke-primary border border-poke-primary/30'
                            : 'bg-poke-surface text-poke-text-muted border border-poke-border line-through'
                        }`}
                      >
                        {t(`discord.formatOptions.${key}.label`)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTest(webhook)}
                  >
                    {t('common.test')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => editingId === webhook.id ? cancelEditing() : startEditing(webhook)}
                  >
                    {editingId === webhook.id ? t('common.cancel') : t('common.edit')}
                  </Button>
                  <Button
                    variant={webhook.enabled ? 'secondary' : 'success'}
                    size="sm"
                    onClick={() => handleToggle(webhook)}
                  >
                    {webhook.enabled ? t('common.disable') : t('common.enable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(webhook.id)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>

              {/* Inline edit form */}
              {editingId === webhook.id && (
                <div className="mt-4 pt-4 border-t border-poke-border space-y-4">
                  {/* Event filter */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-heading font-semibold text-poke-text-primary">
                      {t('common.eventFilter')}
                    </label>
                    <p className="text-xs text-poke-text-muted mb-2">
                      {t('common.eventFilterHint')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {EVENT_TYPES.map((evt) => (
                        <button
                          key={evt}
                          type="button"
                          aria-pressed={editEventFilter.includes(evt)}
                          onClick={() => toggleEditEventFilter(evt)}
                          className={`
                            px-2.5 py-1 text-xs rounded-full border transition-colors
                            ${
                              editEventFilter.includes(evt)
                                ? 'bg-poke-primary/20 border-poke-primary text-poke-primary'
                                : 'bg-poke-surface border-poke-border text-poke-text-secondary hover:border-poke-border-hover'
                            }
                          `}
                        >
                          {eventLabel(evt)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Format options */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-heading font-semibold text-poke-text-primary">
                      {t('discord.messageOptions')}
                    </label>
                    <div className="space-y-2 mt-2">
                      {FORMAT_OPTION_KEYS.map((key) => (
                        <label key={key} className="flex items-start gap-2.5 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={editFormatOptions[key]}
                            onChange={() => toggleEditFormatOption(key)}
                            className="mt-0.5 rounded border-poke-border bg-poke-surface text-poke-primary focus:ring-poke-primary/50"
                          />
                          <div>
                            <span className="text-sm text-poke-text-primary group-hover:text-poke-text-primary/80">
                              {t(`discord.formatOptions.${key}.label`)}
                            </span>
                            <p className="text-xs text-poke-text-muted">{t(`discord.formatOptions.${key}.description`)}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {renderLanguageSelect(`discord-webhook-language-${webhook.id}`, editFormatOptions.language, (language) =>
                    setEditFormatOptions((prev) => ({ ...prev, language })),
                  )}

                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={cancelEditing}>
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" loading={editSaving} onClick={() => handleSaveEdit(webhook.id)}>
                      {t('discord.saveChanges')}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
