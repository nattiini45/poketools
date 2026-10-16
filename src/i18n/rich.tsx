/**
 * Rich message rendering (i18n-core §1.3): `<tag>…</tag>` pairs and
 * `{placeholder}`s become React nodes. No `'use client'` (pure; usable from
 * server and client components) and never `dangerouslySetInnerHTML`: every
 * text chunk is a React string child, so markup in params is escaped.
 *
 * - A tag with a renderer in `values` renders `values[tag](children)`.
 * - An unknown tag renders its children as plain text.
 * - An unmatched closing tag renders literally.
 * - A placeholder with no value stays visible as `{name}`.
 */
import { Fragment, createElement, isValidElement, type ReactNode } from 'react';
import type { Locale } from './config';
import { formatParamNumber } from './intl-cache';

export type RichValues = Readonly<Record<string, unknown>>;

interface TagFrame {
  readonly tag: string | null;
  readonly children: ReactNode[];
}

const TOKEN = /<(\/?)([A-Za-z0-9_]+)>|\{([A-Za-z0-9_]+)\}/g;

function placeholderNode(name: string, values: RichValues, locale: Locale): ReactNode {
  if (!Object.prototype.hasOwnProperty.call(values, name)) return `{${name}}`;
  const value = values[name];
  if (typeof value === 'number') return formatParamNumber(value, locale);
  if (typeof value === 'string' || typeof value === 'boolean' || value === null || value === undefined) {
    return value as ReactNode;
  }
  if (isValidElement(value) || Array.isArray(value)) return value as ReactNode;
  if (typeof value === 'function') return `{${name}}`;
  return String(value);
}

function keyed(nodes: readonly ReactNode[]): ReactNode {
  if (nodes.length === 0) return null;
  if (nodes.length === 1 && (typeof nodes[0] === 'string' || typeof nodes[0] === 'number')) return nodes[0];
  return nodes.map((node, i) => createElement(Fragment, { key: i }, node));
}

function closeFrame(frame: TagFrame, values: RichValues): ReactNode {
  const inner = keyed(frame.children);
  const renderer = frame.tag ? values[frame.tag] : undefined;
  if (typeof renderer === 'function') {
    return (renderer as (chunks: ReactNode) => ReactNode)(inner);
  }
  return inner;
}

export function renderRich(template: string, values: RichValues = {}, locale: Locale = 'en'): ReactNode {
  const stack: TagFrame[] = [{ tag: null, children: [] }];
  const top = () => stack[stack.length - 1];
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(template); match; match = TOKEN.exec(template)) {
    if (match.index > last) top().children.push(template.slice(last, match.index));
    last = match.index + match[0].length;
    const [, slash, tag, placeholder] = match;
    if (placeholder !== undefined) {
      top().children.push(placeholderNode(placeholder, values, locale));
    } else if (slash === '') {
      stack.push({ tag: tag ?? null, children: [] });
    } else {
      const openIndex = findOpen(stack, tag ?? '');
      if (openIndex < 0) {
        top().children.push(match[0]);
        continue;
      }
      // Close any inner frames left open (malformed nesting) into their parent.
      while (stack.length - 1 > openIndex) {
        const inner = stack.pop() as TagFrame;
        top().children.push(...inner.children);
      }
      const frame = stack.pop() as TagFrame;
      top().children.push(closeFrame(frame, values));
    }
  }
  if (last < template.length) top().children.push(template.slice(last));
  // Unclosed tags: flatten their children into the parent as plain content.
  while (stack.length > 1) {
    const inner = stack.pop() as TagFrame;
    top().children.push(...inner.children);
  }
  return keyed(stack[0].children);
}

function findOpen(stack: readonly TagFrame[], tag: string): number {
  for (let i = stack.length - 1; i > 0; i -= 1) {
    if (stack[i].tag === tag) return i;
  }
  return -1;
}
