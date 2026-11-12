'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import Alert from '@/components/ui/Alert';
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
import SettingsSection from './SettingsSection';
import { useSettingsSave } from './settings-save';

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
      // What is stored now: the save bar compares against it.
      setConfig((prev) => (prev ? { ...prev, model_priority: order.map((m) => m.id), default_persona: persona } : prev));
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

  const storedOrder = config ? orderModels(config.model_priority, config.available_models) : [];
  const storedPersona = config?.default_persona || 'linden_teambuilding';
  const dirty =
    config !== null && (persona !== storedPersona || order.map((m) => m.id).join() !== storedOrder.map((m) => m.id).join());
  const reset = useCallback(() => {
    if (!config) return;
    setOrder(orderModels(config.model_priority, config.available_models));
    setPersona(config.default_persona || 'linden_teambuilding');
    setMessage(null);
  }, [config]);
  const hasSaveBar = useSettingsSave('agent-settings', { dirty, saving, save, reset });

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
    <SettingsSection
      icon="up-grade"
      title={t('agentSettings.title')}
      description={t('agentSettings.intro')}
      meta={<Badge variant="purple" size="sm">{t('agentSettings.badge')}</Badge>}
    >
      {loading ? (
        <p className="text-body text-fg-muted">{t('agentSettings.loading')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="max-w-md">
            <Select
              label={t('agentSettings.defaultAssistant')}
              value={persona}
              options={personaOptions}
              onChange={(e) => {
                setPersona(e.target.value);
                setMessage(null);
              }}
            />
          </div>

          <div>
            <p id="agent-model-priority" className="mb-1.5 text-caption font-medium text-fg">
              {t('agentSettings.modelPriority')}
            </p>
            <ol aria-labelledby="agent-model-priority" className="overflow-hidden rounded-poke-md border border-hairline">
              {order.map((m, i) => (
                <li key={m.id} className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-1.5 first:border-t-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="w-4 shrink-0 font-mono text-caption text-fg-muted tabular-nums">{i + 1}</span>
                    <span className="truncate text-body font-[550] text-fg">{MODEL_LABELS[m.id] ?? m.id}</span>
                    <Badge variant="gray" size="sm">{m.tier}</Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={t('agentSettings.moveUp', { model: m.id })}
                    >
                      <ChevronUp size={16} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => move(i, 1)}
                      disabled={i === order.length - 1}
                      aria-label={t('agentSettings.moveDown', { model: m.id })}
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {message && messageText && <Alert variant={message.type === 'success' ? 'success' : 'error'}>{messageText}</Alert>}

          {!hasSaveBar && (
            <div>
              <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!config}>
                {t('agentSettings.save')}
              </Button>
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
