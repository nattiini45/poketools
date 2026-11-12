'use client';

import { useCallback, useState } from 'react';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import type { ApiResult } from '@/types/api';
import { DEFAULT_WORLD_EXPERIENCE, type WorldExperience } from '@/types/player';
import { useMessages, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { accountMessages } from '@/i18n/messages/account';
import { errorsAuth } from '@/i18n/messages/errors';
import SettingsSection from './SettingsSection';
import { useSettingsSave } from './settings-save';

/** The radio order; label and help text live in `account.worldExperience.options`. */
const OPTIONS: readonly WorldExperience[] = ['auto', 'on', 'off'];

/** The last save outcome: a message key, or the API's error. Never translated text. */
type SaveMessage =
  | { type: 'success' }
  | { type: 'error'; key: 'saveFailed' | 'saveFailedRetry' }
  | { type: 'error'; key: 'api'; error: ApiErrorLike };

interface WorldExperienceFormProps {
  initialValue: WorldExperience;
  /**
   * True when the server could not read the stored preference and
   * `initialValue` is the default ('off') fallback — the form discloses that instead
   * of presenting a value that may not be the stored one.
   */
  readFailed?: boolean;
}

/**
 * Radio group for the 3D world experience preference. Saves via
 * PATCH /api/account/world-experience and reports a saved/failed state.
 */
export default function WorldExperienceForm({ initialValue, readFailed = false }: WorldExperienceFormProps) {
  const t = useT(accountMessages);
  const copy = useMessages(accountMessages).worldExperience;
  const errorText = useApiErrorText(errorsAuth);
  const [value, setValue] = useState<WorldExperience>(initialValue);
  // The last value the API confirmed as stored. A failed save reverts the radio
  // to it, so the control never shows a selection that isn't persisted.
  const [savedValue, setSavedValue] = useState<WorldExperience>(initialValue);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<SaveMessage | null>(null);
  // The unread-stored-value disclosure clears once a save round-trip has
  // confirmed what is actually stored.
  const [staleRead, setStaleRead] = useState(readFailed);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/account/world-experience', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldExperience: value }),
      });
      const json = (await res.json()) as ApiResult<{ worldExperience: WorldExperience }>;
      if (!res.ok || !json.success) {
        const apiError = !json.success && json.error ? toApiErrorLike(json) : null;
        // Nothing was persisted, so the control must not keep offering a
        // selection that looks saved.
        setValue(savedValue);
        setMessage(apiError ? { type: 'error', key: 'api', error: apiError } : { type: 'error', key: 'saveFailed' });
        return;
      }
      // Trust the stored value the API echoes back; a response missing `data`
      // still counts as saved, so fall back to what we sent.
      const stored = json.data?.worldExperience ?? value;
      setValue(stored);
      setSavedValue(stored);
      setStaleRead(false);
      setMessage({ type: 'success' });
    } catch {
      setValue(savedValue);
      setMessage({ type: 'error', key: 'saveFailedRetry' });
    } finally {
      setSaving(false);
    }
  }, [value, savedValue]);
  const reset = useCallback(() => {
    setValue(savedValue);
    setMessage(null);
  }, [savedValue]);
  const hasSaveBar = useSettingsSave('world-experience', { dirty: value !== savedValue, saving, save, reset });

  const messageText =
    message === null
      ? null
      : message.type === 'success'
        ? t('worldExperience.saved')
        : message.key === 'api'
          ? errorText(message.error)
          : t(`worldExperience.${message.key}`);

  return (
    <SettingsSection icon="town-map" title={t('worldExperience.title')} description={t('worldExperience.intro')}>
      {staleRead && (
        <Alert variant="warning" className="mb-4">
          {t('worldExperience.staleRead', { option: copy.options[DEFAULT_WORLD_EXPERIENCE].label })}
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={saving}>
          <legend className="mb-2 block text-caption font-medium text-fg">{t('worldExperience.legend')}</legend>
          <div className="flex flex-col gap-2">
            {OPTIONS.map((optionValue) => {
              const option = { value: optionValue, ...copy.options[optionValue] };
              const inputId = `world-experience-${option.value}`;
              const helpId = `${inputId}-help`;
              return (
                <label
                  key={option.value}
                  htmlFor={inputId}
                  className="flex cursor-pointer items-start gap-3 rounded-poke-md border border-hairline px-3 py-2.5 transition-colors duration-80 ease-out hover:bg-hover has-[:checked]:border-hairline-strong has-[:checked]:bg-accent-subtle has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-poke-focus"
                >
                  <input
                    id={inputId}
                    type="radio"
                    name="world-experience"
                    value={option.value}
                    checked={value === option.value}
                    aria-describedby={helpId}
                    onChange={() => {
                      setValue(option.value);
                      setMessage(null);
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent-fill focus-visible:outline-none"
                  />
                  <span className="min-w-0">
                    <span className="block text-body font-[550] text-fg">{option.label}</span>
                    <span id={helpId} className="block text-body text-fg-muted">
                      {option.help}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {message && messageText && (
          <Alert variant={message.type === 'success' ? 'success' : 'error'} className="mt-3">
            {messageText}
          </Alert>
        )}

        {!hasSaveBar && (
          <div className="mt-4">
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              {t('worldExperience.save')}
            </Button>
          </div>
        )}
      </form>
    </SettingsSection>
  );
}
