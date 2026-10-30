import { logger } from '@/lib/logger';
import { anthropicApiKey } from '../api-key';

/**
 * Kale used to have its own model and provider settings. They are gone: Kale follows
 * `CLAUDE_MODEL`, `CLAUDE_FALLBACK_MODEL`, `CLAUDE_API_EFFORT` and `ANTHROPIC_API_KEY` like every
 * other text surface. A deployment that still sets one of the old variables would otherwise be
 * silently ignored (and, for `KALE_API_KEY` alone, silently switched off), so the first call in a
 * process logs one warning that names them. Only the names are logged, never the values.
 */
export const REMOVED_KALE_SETTINGS = [
  'KALE_API_KEY',
  'KALE_MODEL',
  'KALE_PROVIDER',
  'KALE_BASE_URL',
  'KALE_FALLBACK_MODEL',
  'KALE_TEMPERATURE',
  'KALE_REASONING_EFFORT',
  'KALE_DISABLE_FALLBACK',
  'KALE_DEBUG',
] as const;

let warned = false;

/** Log the one-time warning when a removed Kale variable is set. Cheap after the first call. */
export function warnRemovedKaleSettings(): void {
  if (warned) return;
  const present = REMOVED_KALE_SETTINGS.filter((name) => (process.env[name] ?? '').trim() !== '');
  if (present.length === 0) return;
  warned = true;
  const keyMissing = anthropicApiKey() === '';
  logger.warn(
    'kale/provider',
    `${present.join(', ')} ${present.length === 1 ? 'is' : 'are'} no longer used; Kale follows CLAUDE_MODEL / CLAUDE_FALLBACK_MODEL and ANTHROPIC_API_KEY.` +
      (keyMissing ? ' No Anthropic API key is configured (ANTHROPIC_API_KEY), so Kale reports stay disabled.' : ''),
    { removed: present, anthropic_key_configured: !keyMissing }
  );
}

/** Test hook: forget that the warning was logged. */
export function resetRemovedKaleSettingsWarning(): void {
  warned = false;
}
