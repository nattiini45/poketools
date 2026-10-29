/**
 * What a Claude model id accepts on the raw Messages API.
 *
 * The legacy client sends `temperature: 0.2` on every request. Newer models reject sampling
 * parameters with a 400 (the 5.x family and Opus 4.7 or later), so the value is sent only to
 * ids known to accept it. An id this module cannot parse is treated as "rejects": omitting
 * `temperature` is always valid, while sending it to a model that refuses it is a hard failure
 * that the fallback ladder would otherwise paper over.
 *
 * Model ids follow `claude-<family>-<major>[-<minor>][-<yyyymmdd>]`, e.g. `claude-sonnet-4-6`,
 * `claude-haiku-4-5-20251001`, `claude-opus-5-5`. The pre-4 ids (`claude-3-5-sonnet-...`) accept
 * temperature and are matched separately.
 */

interface ParsedModel {
  family: string;
  major: number;
  minor: number;
}

const MODEL_ID = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?$/;
const LEGACY_MODEL_ID = /^claude-(?:3|2|instant)/;

function parseModel(model: string): ParsedModel | null {
  const match = MODEL_ID.exec(model);
  if (!match) return null;
  return { family: match[1], major: Number(match[2]), minor: match[3] ? Number(match[3]) : 0 };
}

/**
 * True when the model accepts a `temperature` value. False for the 5.x family, Opus 4.7 or
 * later, and any id that is not a recognised Claude id. Sonnet 4.6 and Haiku 4.5 accept it.
 */
export function modelAcceptsTemperature(model: string): boolean {
  if (LEGACY_MODEL_ID.test(model)) return true;
  const parsed = parseModel(model);
  if (!parsed) return false;
  if (parsed.major >= 5) return false;
  if (parsed.family === 'opus' && parsed.major === 4 && parsed.minor >= 7) return false;
  return true;
}

/**
 * True when the model accepts `output_config.effort`. Haiku 4.5 and older models do not;
 * Sonnet 4.6, Opus 4.5 or later and the 5.x family do.
 */
export function modelSupportsEffort(model: string): boolean {
  const parsed = parseModel(model);
  if (!parsed) return false;
  if (parsed.major >= 5) return true;
  if (parsed.major < 4) return false;
  if (parsed.family === 'opus') return parsed.minor >= 5;
  if (parsed.family === 'sonnet') return parsed.minor >= 6;
  return false;
}
