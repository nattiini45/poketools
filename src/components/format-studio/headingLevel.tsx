import { createElement, type ReactNode } from 'react';

/** A heading level a Studio component may use; its own headings sit one level below it. */
export type HeadingLevel = 2 | 3 | 4 | 5;

/** The level of the headings directly below a heading of this level (capped at `h5`). */
export function childLevel(level: HeadingLevel): HeadingLevel {
  return Math.min(level + 1, 5) as HeadingLevel;
}

/** A heading at an explicit level (`h2` .. `h5`), so a shared component can follow the hierarchy of its parent. */
export function Heading({ level, className, children }: { level: HeadingLevel; className?: string; children: ReactNode }) {
  return createElement(`h${level}`, { className }, children);
}
