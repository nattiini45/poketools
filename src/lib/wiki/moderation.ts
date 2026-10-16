const URL_REGEX = /https?:\/\//gi;
const HTML_MARKUP_REGEX = /<\/?[a-z][\s\S]*>/i;
const REPEATED_CHARACTER_REGEX = /(.)\1{12,}/;

export function scanWikiNoteContent(content: string): string[] {
  const flags: string[] = [];
  const urls = content.match(URL_REGEX) ?? [];

  if (urls.length > 3) flags.push('too_many_links');
  if (HTML_MARKUP_REGEX.test(content)) flags.push('html_markup');
  if (REPEATED_CHARACTER_REGEX.test(content)) flags.push('repeated_characters');

  const letters = [...content].filter((char) => /[a-z]/i.test(char));
  if (letters.length >= 40) {
    const upper = letters.filter((char) => char === char.toUpperCase()).length;
    if (upper / letters.length > 0.8) flags.push('excessive_caps');
  }

  return flags;
}