'use client';

import { useCallback, useEffect, useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import type {
  CreateSocialIntegrationInput,
  SocialCredentials,
  SocialEventType,
  SocialIntegration,
  SocialPostOptions,
  SocialProvider,
  SocialScopeType,
} from '@/types/social';
import { DEFAULT_SOCIAL_POST_OPTIONS } from '@/types/social';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsBroadcast } from '@/i18n/messages/errors/broadcast';
import { integrationsMessages } from '@/i18n/messages/integrations';

const EVENT_TYPES: readonly SocialEventType[] = [
  'match_result_submitted',
  'match_confirmed',
  'match_disputed',
  'round_generated',
  'round_completed',
  'round_recap_published',
  'round_forecast_published',
  'tournament_started',
  'tournament_completed',
  'season_advanced',
  'draft_pick_made',
  'draft_completed',
  'draft_turn_started',
  'draft_turn_reminder',
  'draft_slot_blocked',
  'draft_redraft_published',
  'achievement_unlocked',
  'streak_milestone',
  'streak_broken',
  'rating_milestone',
];

/** Provider brand names: not translated. */
const PROVIDER_LABEL: Record<SocialProvider, string> = {
  x: 'X',
  threads: 'Threads',
  bluesky: 'Bluesky',
};

const PROVIDER_OPTIONS: { value: SocialProvider; label: string }[] = (
  Object.keys(PROVIDER_LABEL) as SocialProvider[]
).map((value) => ({ value, label: PROVIDER_LABEL[value] }));

const SCOPE_TYPES: readonly SocialScopeType[] = ['global', 'season', 'tournament'];

const POST_OPTION_KEYS: readonly (keyof SocialPostOptions)[] = ['include_replay_link', 'include_hashtags'];

interface CredentialsFormValues {
  xAccessToken: string;
  xRefreshToken: string;
  xUserId: string;
  xAccountLabel: string;
  threadsAccessToken: string;
  threadsUserId: string;
  threadsAccountLabel: string;
  blueskyHandle: string;
  blueskyAppPassword: string;
  blueskyServiceUrl: string;
}

/** A failed call: the API's error object, plus local text for when it carries none. */
interface ErrorState {
  res: ApiErrorLike;
  fallback: string;
}

function buildCredentials(provider: SocialProvider, values: CredentialsFormValues): SocialCredentials | undefined {
  if (provider === 'x') {
    if (!values.xAccessToken.trim()) return undefined;
    return {
      provider: 'x',
      access_token: values.xAccessToken.trim(),
      refresh_token: values.xRefreshToken.trim() || undefined,
      user_id: values.xUserId.trim() || undefined,
      account_label: values.xAccountLabel.trim() || undefined,
    };
  }

  if (provider === 'threads') {
    if (!values.threadsAccessToken.trim() || !values.threadsUserId.trim()) return undefined;
    return {
      provider: 'threads',
      access_token: values.threadsAccessToken.trim(),
      user_id: values.threadsUserId.trim(),
      account_label: values.threadsAccountLabel.trim() || undefined,
    };
  }

  if (!values.blueskyHandle.trim() || !values.blueskyAppPassword.trim()) return undefined;
  return {
    provider: 'bluesky',
    handle: values.blueskyHandle.trim(),
    app_password: values.blueskyAppPassword.trim(),
    service_url: values.blueskyServiceUrl.trim() || undefined,
  };
}

export default function SocialIntegrationManager() {
  const t = useT(integrationsMessages);
  const errorText = useApiErrorText(errorsBroadcast);

  const [integrations, setIntegrations] = useState<SocialIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorState | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formProvider, setFormProvider] = useState<SocialProvider>('x');
  const [formScopeType, setFormScopeType] = useState<SocialScopeType>('global');
  const [formScopeId, setFormScopeId] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formEventFilter, setFormEventFilter] = useState<SocialEventType[]>([]);
  const [formPostOptions, setFormPostOptions] = useState<SocialPostOptions>({ ...DEFAULT_SOCIAL_POST_OPTIONS });

  const [xAccessToken, setXAccessToken] = useState('');
  const [xRefreshToken, setXRefreshToken] = useState('');
  const [xUserId, setXUserId] = useState('');
  const [xAccountLabel, setXAccountLabel] = useState('');

  const [threadsAccessToken, setThreadsAccessToken] = useState('');
  const [threadsUserId, setThreadsUserId] = useState('');
  const [threadsAccountLabel, setThreadsAccountLabel] = useState('');

  const [blueskyHandle, setBlueskyHandle] = useState('');
  const [blueskyAppPassword, setBlueskyAppPassword] = useState('');
  const [blueskyServiceUrl, setBlueskyServiceUrl] = useState('');

  const fail = useCallback((e: unknown, fallback: string) => {
    setError({ res: toApiErrorLike(e), fallback });
  }, []);

  const scopeOptions = SCOPE_TYPES.map((value) => ({ value, label: t(`scopes.${value}`) }));

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/social-integrations');
      const payload = await response.json() as {
        success: boolean;
        data?: SocialIntegration[];
        error?: string;
        code?: string;
        params?: Record<string, string | number>;
      };

      if (!payload.success) {
        fail(payload, t('social.errors.load'));
        return;
      }

      setIntegrations(payload.data ?? []);
    } catch (err) {
      fail(err, t('social.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [fail, t]);

  useEffect(() => {
    void fetchIntegrations();
  }, [fetchIntegrations]);

  const resetForm = () => {
    setFormScopeType('global');
    setFormScopeId('');
    setFormLabel('');
    setFormEventFilter([]);
    setFormPostOptions({ ...DEFAULT_SOCIAL_POST_OPTIONS });
    setXAccessToken('');
    setXRefreshToken('');
    setXUserId('');
    setXAccountLabel('');
    setThreadsAccessToken('');
    setThreadsUserId('');
    setThreadsAccountLabel('');
    setBlueskyHandle('');
    setBlueskyAppPassword('');
    setBlueskyServiceUrl('');
  };

  const toggleEventFilter = (eventType: SocialEventType) => {
    setFormEventFilter((prev) =>
      prev.includes(eventType) ? prev.filter((value) => value !== eventType) : [...prev, eventType],
    );
  };

  const togglePostOption = (key: keyof SocialPostOptions) => {
    setFormPostOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const credentials = buildCredentials(formProvider, {
        xAccessToken,
        xRefreshToken,
        xUserId,
        xAccountLabel,
        threadsAccessToken,
        threadsUserId,
        threadsAccountLabel,
        blueskyHandle,
        blueskyAppPassword,
        blueskyServiceUrl,
      });

      const payload: CreateSocialIntegrationInput = {
        provider: formProvider,
        scope_type: formScopeType,
        scope_id: formScopeType === 'global' ? null : formScopeId || null,
        label: formLabel,
        event_filter: formEventFilter,
        post_options: formPostOptions,
        credentials,
      };

      const response = await fetch('/api/social-integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { success: boolean; error?: string; code?: string };
      if (!result.success) {
        fail(result, t('social.errors.create'));
        return;
      }

      setShowForm(false);
      resetForm();
      await fetchIntegrations();
    } catch (err) {
      fail(err, t('social.errors.create'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (integration: SocialIntegration) => {
    try {
      const response = await fetch(`/api/social-integrations/${integration.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !integration.enabled }),
      });
      const result = await response.json() as { success: boolean; error?: string; code?: string };
      if (!result.success) {
        fail(result, t('social.errors.update'));
        return;
      }
      await fetchIntegrations();
    } catch (err) {
      fail(err, t('social.errors.update'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('social.deleteConfirm'))) return;

    try {
      const response = await fetch(`/api/social-integrations/${id}`, {
        method: 'DELETE',
      });
      const result = await response.json() as { success: boolean; error?: string; code?: string };
      if (!result.success) {
        fail(result, t('social.errors.delete'));
        return;
      }
      await fetchIntegrations();
    } catch (err) {
      fail(err, t('social.errors.delete'));
    }
  };

  const handleTest = async (id: string) => {
    try {
      const response = await fetch(`/api/social-integrations/${id}/test`, { method: 'POST' });
      const result = await response.json() as { success: boolean; error?: string; code?: string };
      if (!result.success) {
        fail(result, t('social.errors.test'));
        return;
      }
      alert(t('social.testSent'));
    } catch (err) {
      fail(err, t('social.errors.test'));
    }
  };

  const sortedIntegrations = [...integrations].sort((a, b) => {
    if (a.provider !== b.provider) {
      return a.provider.localeCompare(b.provider);
    }
    return b.created_at.localeCompare(a.created_at);
  });

  const errorMessage = error
    ? (error.res.error || error.res.code ? errorText(error.res) : error.fallback)
    : null;

  const credentialStatus = (integration: SocialIntegration): string => {
    if (!integration.has_credentials) return t('social.credentialsNotConfigured');
    return integration.credential_hint
      ? t('social.credentialsConfiguredHint', { hint: integration.credential_hint })
      : t('social.credentialsConfigured');
  };

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 rounded-poke-md text-sm text-poke-danger-tint-ink">
          {errorMessage}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant={showForm ? 'ghost' : 'primary'}
          size="sm"
          onClick={() => setShowForm((prev) => !prev)}
        >
          {showForm ? t('common.cancel') : t('social.addIntegration')}
        </Button>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="space-y-4">
            <h3 className="font-heading font-semibold text-poke-text-primary">{t('social.newIntegration')}</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                id="social-integration-provider"
                label={t('social.provider')}
                value={formProvider}
                onChange={(event) => setFormProvider(event.target.value as SocialProvider)}
                options={PROVIDER_OPTIONS}
              />

              <Select
                id="social-integration-scope"
                label={t('common.scope')}
                value={formScopeType}
                onChange={(event) => setFormScopeType(event.target.value as SocialScopeType)}
                options={scopeOptions}
              />
            </div>

            {formScopeType !== 'global' && (
              <Input
                label={formScopeType === 'season' ? t('common.seasonId') : t('common.tournamentId')}
                value={formScopeId}
                onChange={(event) => setFormScopeId(event.target.value)}
                placeholder={t('common.scopeIdPlaceholder')}
              />
            )}

            <Input
              label={t('common.label')}
              value={formLabel}
              onChange={(event) => setFormLabel(event.target.value)}
              placeholder={t('social.labelPlaceholder')}
              required
            />

            <div className="space-y-1.5">
              <label className="block text-sm font-heading font-semibold text-poke-text-primary">
                {t('common.eventFilter')}
              </label>
              <p className="text-xs text-poke-text-muted mb-2">
                {t('common.eventFilterHint')}
              </p>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map((eventType) => (
                  <button
                    key={eventType}
                    type="button"
                    aria-pressed={formEventFilter.includes(eventType)}
                    onClick={() => toggleEventFilter(eventType)}
                    className={`
                      px-2.5 py-1 text-xs rounded-full border transition-colors
                      ${
                        formEventFilter.includes(eventType)
                          ? 'bg-poke-primary/20 border-poke-primary text-poke-primary'
                          : 'bg-poke-surface border-poke-border text-poke-text-secondary hover:border-poke-border-hover'
                      }
                    `}
                  >
                    {t(`events.${eventType}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-heading font-semibold text-poke-text-primary">
                {t('social.postOptions')}
              </label>
              <div className="space-y-2 mt-2">
                {POST_OPTION_KEYS.map((key) => (
                  <label key={key} className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={formPostOptions[key]}
                      onChange={() => togglePostOption(key)}
                      className="mt-0.5 rounded border-poke-border bg-poke-surface text-poke-primary focus:ring-poke-primary/50"
                    />
                    <div>
                      <span className="text-sm text-poke-text-primary group-hover:text-poke-text-primary/80">
                        {t(`social.postOptionLabels.${key}.label`)}
                      </span>
                      <p className="text-xs text-poke-text-muted">{t(`social.postOptionLabels.${key}.description`)}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {formProvider === 'x' && (
              <div className="space-y-3 border border-poke-border rounded-poke-md p-3">
                <h4 className="text-sm font-heading font-semibold text-poke-text-primary">{t('social.credentials.xTitle')}</h4>
                <Input
                  label={t('social.credentials.accessToken')}
                  value={xAccessToken}
                  onChange={(event) => setXAccessToken(event.target.value)}
                  type="password"
                  hint={t('social.credentials.requiredToPost')}
                />
                <Input
                  label={t('social.credentials.refreshToken')}
                  value={xRefreshToken}
                  onChange={(event) => setXRefreshToken(event.target.value)}
                  type="password"
                />
                <Input
                  label={t('social.credentials.userId')}
                  value={xUserId}
                  onChange={(event) => setXUserId(event.target.value)}
                />
                <Input
                  label={t('social.credentials.accountLabel')}
                  value={xAccountLabel}
                  onChange={(event) => setXAccountLabel(event.target.value)}
                  placeholder={t('social.credentials.accountLabelPlaceholder')}
                />
              </div>
            )}

            {formProvider === 'threads' && (
              <div className="space-y-3 border border-poke-border rounded-poke-md p-3">
                <h4 className="text-sm font-heading font-semibold text-poke-text-primary">{t('social.credentials.threadsTitle')}</h4>
                <Input
                  label={t('social.credentials.accessToken')}
                  value={threadsAccessToken}
                  onChange={(event) => setThreadsAccessToken(event.target.value)}
                  type="password"
                  hint={t('social.credentials.requiredToPost')}
                />
                <Input
                  label={t('social.credentials.userId')}
                  value={threadsUserId}
                  onChange={(event) => setThreadsUserId(event.target.value)}
                  hint={t('social.credentials.threadsUserIdHint')}
                />
                <Input
                  label={t('social.credentials.accountLabel')}
                  value={threadsAccountLabel}
                  onChange={(event) => setThreadsAccountLabel(event.target.value)}
                  placeholder={t('social.credentials.accountLabelPlaceholder')}
                />
              </div>
            )}

            {formProvider === 'bluesky' && (
              <div className="space-y-3 border border-poke-border rounded-poke-md p-3">
                <h4 className="text-sm font-heading font-semibold text-poke-text-primary">{t('social.credentials.blueskyTitle')}</h4>
                <Input
                  label={t('social.credentials.handle')}
                  value={blueskyHandle}
                  onChange={(event) => setBlueskyHandle(event.target.value)}
                  placeholder={t('social.credentials.handlePlaceholder')}
                  hint={t('social.credentials.blueskyHandleHint')}
                />
                <Input
                  label={t('social.credentials.appPassword')}
                  value={blueskyAppPassword}
                  onChange={(event) => setBlueskyAppPassword(event.target.value)}
                  type="password"
                  hint={t('social.credentials.blueskyAppPasswordHint')}
                />
                <Input
                  label={t('social.credentials.serviceUrl')}
                  value={blueskyServiceUrl}
                  onChange={(event) => setBlueskyServiceUrl(event.target.value)}
                  placeholder="https://bsky.social"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" loading={submitting}>
                {t('social.createIntegration')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-poke-text-muted">{t('social.loading')}</p>
      ) : sortedIntegrations.length === 0 ? (
        <Card>
          <p className="text-center text-poke-text-secondary py-4">
            {t('social.empty')}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedIntegrations.map((integration) => (
            <Card key={integration.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-heading font-semibold text-poke-text-primary truncate">
                      {integration.label}
                    </h3>
                    <Badge variant={integration.enabled ? 'green' : 'default'}>
                      {integration.enabled ? t('common.active') : t('common.disabled')}
                    </Badge>
                    <Badge variant="blue">{PROVIDER_LABEL[integration.provider]}</Badge>
                    <Badge variant="purple">
                      {integration.scope_type === 'global'
                        ? t('common.global')
                        : `${integration.scope_type}: ${integration.scope_id?.slice(0, 8)}...`}
                    </Badge>
                  </div>

                  <p className="text-xs text-poke-text-muted">
                    {t('social.credentialsStatus', { status: credentialStatus(integration) })}
                  </p>

                  {integration.event_filter.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {integration.event_filter.map((eventType) => (
                        <span
                          key={eventType}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-poke-surface border border-poke-border text-poke-text-secondary"
                        >
                          {EVENT_TYPES.includes(eventType) ? t(`events.${eventType}`) : eventType}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {POST_OPTION_KEYS.map((key) => (
                      <span
                        key={key}
                        className={`px-1.5 py-0.5 text-[10px] rounded ${
                          integration.post_options[key]
                            ? 'bg-poke-primary/10 text-poke-primary border border-poke-primary/30'
                            : 'bg-poke-surface text-poke-text-muted border border-poke-border line-through'
                        }`}
                      >
                        {t(`social.postOptionLabels.${key}.label`)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex gap-1.5 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => handleTest(integration.id)}>
                    {t('common.test')}
                  </Button>
                  <Button
                    variant={integration.enabled ? 'secondary' : 'success'}
                    size="sm"
                    onClick={() => handleToggle(integration)}
                  >
                    {integration.enabled ? t('common.disable') : t('common.enable')}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(integration.id)}>
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
