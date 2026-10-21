'use client';

import { useCallback, useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import type { ApiResult } from '@/types/api';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { accountMessages } from '@/i18n/messages/account';
import { errorsAi } from '@/i18n/messages/errors';
import type accountEn from '@/i18n/messages/account/en';

type PersonaKey = keyof typeof accountEn.agentSettings.personas;

/** Persona options (mirrors `agentPersonaSchema`); labels in `account.agentSettings.personas`. */
const PERSONA_VALUES: readonly PersonaKey[] = ['linden_teambuilding', 'linden_match_prep', 'kale'];

/** The last save/load outcome: a message key, or the API's error. Never translated text. */
type SettingsMessage =
  | { type: 'success' }
  | { type: 'error'; key: 'loadFailed' | 'saveFailed' }
  | { type: 'error'; key: 'api'; error: ApiErrorLike };

/** Friendly display names for known model ids; falls back to the raw id. */
const MODEL_LABELS: Record<string, string> = {
  'mimo-v2.6-pro': 'MiMo v2.6 Pro (Xiaomi)',
  'deepseek-v4-pro': 'DeepSeek v4 Pro',
  'minimax-m3': 'MiniMax M3 (vision)',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
};

interface AgentConfig {
  model_priority: string[];
  default_persona: string;
  available_models: { id: string; tier: string }[];
}

type ConfigData = {
  model_priority: unknown;
  default_persona: string;
  available_models: { id: string; tier: string }[];
};

/**
 * Builds the working model order: the player's stored priority first (known ids
 * only), then any registry models they haven't ranked — mirrors the server-side
 * `selectModels` ordering so the list the user sees IS the fallback order.
 */
function orderModels(
  priority: string[],
  available: { id: string; tier: string }[],
): { id: string; tier: string }[] {
  const byId = new Map(available.map((m) => [m.id, m]));
  const ordered: { id: string; tier: string }[] = [];
  for (const id of priority) {
    const m = byId.get(id);
    if (m && !ordered.some((o) => o.id === id)) ordered.push(m);
  }
  for (const m of available) {
    if (!ordered.some((o) => o.id === m.id)) ordered.push(m);
  }
  return ordered;
}

export default function AgentSettingsForm() {
  const t = useT(accountMessages);
  const errorText = useApiErrorText(errorsAi);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [order, setOrder] = useState<{ id: string; tier: string }[]>([]);
  const [persona, setPersona] = useState('linden_teambuilding');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<SettingsMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/agent/config');
        const json = (await res.json()) as ApiResult<ConfigData>;
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setMessage({ type: 'error', key: 'loadFailed' });
          return;
        }
        const priority = Array.isArray(json.data.model_priority)
          ? (json.data.model_priority as unknown[]).filter((v): v is string => typeof v === 'string')
          : [];
        const available = json.data.available_models ?? [];
        setConfig({ model_priority: priority, default_persona: json.data.default_persona, available_models: available });
        setOrder(orderModels(priority, available));
        setPersona(json.data.default_persona || 'linden_teambuilding');
      } catch {
        if (!cancelled) setMessage({ type: 'error', key: 'loadFailed' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function move(index: number, dir: -1 | 1) {
    setOrder((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setMessage(null);
  }

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ai/agent/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_priority: order.map((m) => m.id),
          default_persona: persona,
        }),
      });
      const json = (await res.json()) as ApiResult<unknown>;
      if (!res.ok || !json.success) {
        const apiError = json.success ? null : toApiErrorLike(json);
        setMessage(
          apiError && (apiError.error || apiError.code)
            ? { type: 'error', key: 'api', error: apiError }
            : { type: 'error', key: 'saveFailed' },
        );
        return;
      }
      setMessage({ type: 'success' });
    } catch (err) {
      const apiError = toApiErrorLike(err);
      setMessage(
        apiError.error || apiError.code
          ? { type: 'error', key: 'api', error: apiError }
          : { type: 'error', key: 'saveFailed' },
      );
    } finally {
      setSaving(false);
    }
  }, [order, persona]);

  const messageText =
    message === null
      ? null
      : message.type === 'success'
        ? t('agentSettings.saved')
        : message.key === 'api'
          ? errorText(message.error)
          : t(`agentSettings.${message.key}`);

  const personaOptions = PERSONA_VALUES.map((value) => ({
    value,
    label: t(`agentSettings.personas.${value}`),
  }));

  return (
    <Card variant="outlined" padding="lg">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-lg font-heading font-bold text-poke-text-primary">{t('agentSettings.title')}</h2>
        <Badge variant="purple" size="sm">{t('agentSettings.badge')}</Badge>
      </div>
      <p className="text-sm text-poke-text-muted mb-4">
        {t('agentSettings.intro')}
      </p>

      {loading ? (
        <p className="text-sm text-poke-text-muted py-4">{t('agentSettings.loading')}</p>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-1.5">
              {t('agentSettings.defaultAssistant')}
            </label>
            <Select
              value={persona}
              options={personaOptions}
              onChange={(e) => {
                setPersona(e.target.value);
                setMessage(null);
              }}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-1.5">
              {t('agentSettings.modelPriority')}
            </label>
            <ul className="space-y-2">
              {order.map((m, i) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-poke-text-muted tabular-nums w-4">{i + 1}.</span>
                    <span className="text-sm font-heading font-semibold text-poke-text-primary truncate">
                      {MODEL_LABELS[m.id] ?? m.id}
                    </span>
                    <Badge variant="gray" size="sm">{m.tier}</Badge>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={t('agentSettings.moveUp', { model: m.id })}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => move(i, 1)}
                      disabled={i === order.length - 1}
                      aria-label={t('agentSettings.moveDown', { model: m.id })}
                    >
                      ↓
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {message && messageText && (
            <div
              className={`text-sm px-3 py-2 rounded-poke-md ${
                message.type === 'success'
                  ? 'bg-poke-green-light text-poke-green'
                  : 'bg-poke-accent-light text-poke-accent'
              }`}
            >
              {messageText}
            </div>
          )}

          <Button
            variant="primary"
            onClick={() => void save()}
            loading={saving}
            disabled={!config}
          >
            {t('agentSettings.save')}
          </Button>
        </div>
      )}
    </Card>
  );
}
