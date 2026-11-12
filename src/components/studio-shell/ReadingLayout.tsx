import type { ReactNode } from 'react';

export interface ReadingOutlineItem {
  /** The DOM id of the section the link jumps to. */
  id: string;
  label: string;
}

interface ReadingLayoutProps {
  /** Names the outline landmark ("On this page"). */
  outlineLabel: string;
  outline: readonly ReadingOutlineItem[];
  children: ReactNode;
}

/**
 * A detail page of a studio (a format, a ruleset): the generated rules in one reading column about 68 characters wide, with
 * an outline of its sections beside it from `lg` up (sticky, so it follows the scroll). On a phone the page is one
 * column and the outline is a strip of anchors above the text. Hook-free and server-safe.
 */
export default function ReadingLayout({ outlineLabel, outline, children }: ReadingLayoutProps) {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,46rem)_13rem] lg:gap-10" data-reading-layout>
      {outline.length > 1 && (
        <nav aria-label={outlineLabel} className="min-w-0 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 hidden text-caption font-[550] text-fg-muted lg:block">{outlineLabel}</p>
          <ul className="flex gap-x-4 gap-y-1 overflow-x-auto border-b border-hairline pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:border-b-0 lg:border-l lg:pb-0">
            {outline.map((item) => (
              <li key={item.id} className="shrink-0 lg:shrink">
                <a
                  href={`#${item.id}`}
                  className="inline-flex min-h-11 items-center whitespace-nowrap text-body text-fg-muted hover:text-fg hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink lg:min-h-0 lg:whitespace-normal lg:py-0.5 lg:pl-3"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="min-w-0 space-y-6 lg:order-1">{children}</div>
    </div>
  );
}
