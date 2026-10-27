import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

/**
 * The assistant's prose, rendered from an allow-list (plan 5.8). The text is model output that may have been shaped by a
 * poisoned league description, so nothing in it can load a resource or leave the site:
 *   - no raw HTML (React escapes it to text), no images (`![alt](url)` shows only the alt text, never fetching the URL);
 *   - a link becomes an anchor only when its target is a path on this site (it starts with one slash); any other target, including
 *     `javascript:` and `https://...`, is shown as plain text next to the label;
 *   - allowed: paragraphs, line breaks, `**bold**`, `*italic*`, `` `code` ``, bullet and numbered lists, fenced code,
 *     and `#` headings (shown as bold lines, so the page keeps its own heading outline).
 */

type Block =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; text: string };

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const FENCE = /^\s{0,3}```/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    if (bullet !== null || numbered !== null) {
      flush();
      const ordered = numbered !== null;
      const last = blocks[blocks.length - 1];
      const item = (bullet ?? numbered)?.[1] ?? '';
      if (last?.type === 'list' && last.ordered === ordered) last.items.push(item);
      else blocks.push({ type: 'list', ordered, items: [item] });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ type: 'paragraph', lines: [`**${heading[1].replace(/\*+/g, '')}**`] });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** A path on this site: one leading slash, no scheme, no protocol-relative form, only URL-safe characters. */
export function isSitePath(target: string): boolean {
  return /^\/(?!\/)[A-Za-z0-9\-._~/?=&#%]*$/.test(target) && !target.includes('..');
}

const INLINE = /(`[^`\n]+`)|(!?)\[([^\]\n]{0,200})\]\(([^)\s]{1,500})\)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\b_[^_\n]+_\b)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyPrefix}-${index}`;
    index += 1;
    const [whole, code, bang, label, target, bold, italicStar, italicUnderscore] = match;
    if (code !== undefined) {
      out.push(
        <code key={key} className="rounded bg-poke-muted px-1 py-0.5 text-[0.85em]">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (target !== undefined) {
      if (bang === '!') {
        // An image is never fetched: only its description is shown.
        out.push(label);
      } else if (isSitePath(target)) {
        out.push(
          <Link key={key} href={target} className="underline text-poke-focus">
            {label}
          </Link>,
        );
      } else {
        out.push(`${label} (${target})`);
      }
    } else if (bold !== undefined) {
      out.push(<strong key={key}>{bold.slice(2, -2)}</strong>);
    } else if (italicStar !== undefined) {
      out.push(<em key={key}>{italicStar.slice(1, -1)}</em>);
    } else if (italicUnderscore !== undefined) {
      out.push(<em key={key}>{italicUnderscore.slice(1, -1)}</em>);
    } else {
      out.push(whole);
    }
    last = at + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={className ?? 'space-y-2 break-words text-sm leading-relaxed'}>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        if (block.type === 'code') {
          return (
            <pre key={key} className="overflow-x-auto rounded-poke-md border border-poke-border bg-poke-muted p-2 text-xs">
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag key={key} className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5`}>
              {block.items.map((item, j) => (
                <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((line, j) => (
              <Fragment key={`${key}-${j}`}>
                {j > 0 && <br />}
                {renderInline(line, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
