/**
 * Cheap, deterministic text checks the graders share: language, sentence and paragraph counts,
 * punctuation rules of the persona prompts. None of them judges quality; they catch the gross
 * failures (wrong language, empty or runaway output, a cut-off ending) at no cost.
 */

import type { Locale } from './types';

const EN_STOPWORDS = new Set([
  'the', 'and', 'is', 'of', 'to', 'in', 'that', 'for', 'on', 'with', 'was', 'has', 'its', 'it', 'this',
  'but', 'as', 'at', 'by', 'from', 'their', 'they', 'his', 'her', 'then', 'which', 'into', 'after',
]);

const DE_STOPWORDS = new Set([
  'der', 'die', 'das', 'und', 'ist', 'mit', 'nicht', 'ein', 'eine', 'den', 'dem', 'von', 'zu', 'auf',
  'für', 'im', 'war', 'hat', 'sich', 'wird', 'sind', 'auch', 'aber', 'dass', 'nach', 'bei', 'als',
  'wie', 'noch', 'dann', 'sein', 'seine', 'ihr', 'ihre', 'des', 'zum', 'zur', 'über', 'durch',
]);

/** Which of English and German the stopword counts of `text` favour; null when there is too little text to tell. */
export function detectLanguage(text: string): Locale | null {
  const words = text.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  if (words.length < 8) return null;
  let en = 0;
  let de = 0;
  for (const w of words) {
    if (EN_STOPWORDS.has(w)) en += 1;
    if (DE_STOPWORDS.has(w)) de += 1;
  }
  if (en === 0 && de === 0) return null;
  return de > en ? 'de' : 'en';
}

/** Every string value inside a parsed JSON value, joined (keys excluded). */
export function proseOf(value: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(value);
  return parts.join(' ');
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

export function hasEmoji(text: string): boolean {
  return EMOJI.test(text);
}

export function hasExclamation(text: string): boolean {
  return text.includes('!');
}

/** Sentences by terminal punctuation followed by space or end; abbreviations make this approximate. */
export function sentenceCount(text: string): number {
  const matches = text.trim().match(/[^.!?]+[.!?]+(?=\s|$)/g);
  return matches ? matches.length : text.trim() === '' ? 0 : 1;
}

export function paragraphCount(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

/** Whether the text ends like a finished sentence or list (not mid-word). */
export function endsCleanly(text: string): boolean {
  return /[.!?)"'”\]*]\s*$/.test(text.trim()) || /\b[A-F]\s*$/.test(text.trim());
}

/**
 * The recap headline is `narrative.split('.')[0]`. That cuts at an abbreviation ("Mr. Mime"), an
 * ordinal in German ("Der 3. Platz"), or a decimal; report whether the first segment is a whole sentence.
 */
export function firstSentenceByDotSplit(narrative: string): { text: string; clean: boolean } {
  const first = narrative.split('.')[0] ?? '';
  const rest = narrative.slice(first.length + 1);
  const abbreviation = /\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|Nr|St)$/i.test(first);
  const ordinal = /\d$/.test(first) && /^\s*[a-zäöü]/.test(rest);
  const tiny = first.trim().length < 15;
  return { text: first, clean: !abbreviation && !ordinal && !tiny };
}

/** Parse a JSON object out of model text the way the Kale assembler does (fences and preamble tolerated). */
export function parseLooseJson(raw: string): Record<string, unknown> | null {
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  cleaned = cleaned.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
