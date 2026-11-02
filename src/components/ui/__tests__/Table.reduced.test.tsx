/**
 * An animated table reveals its rows one after another; a viewer who asks for reduced motion gets every row at once
 * (the opacity fade stays). `motion.tbody` is replaced by a probe that records the stagger it was given.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { STAGGER } from '@/lib/motion/tokens';

const state = vi.hoisted(() => ({ reduced: false }));

vi.mock('@/components/shared/motion', () => ({
  useReducedMotion: () => state.reduced,
  motion: {
    tbody: ({
      variants,
      children,
    }: {
      variants?: { visible?: { transition?: { staggerChildren?: number } } };
      children?: ReactNode;
    }) => <tbody data-stagger={variants?.visible?.transition?.staggerChildren}>{children}</tbody>,
    tr: ({ children }: { children?: ReactNode }) => <tr>{children}</tr>,
  },
}));

import Table from '../Table';

const columns = [{ key: 'name', header: 'Name' }];
const data = [{ name: 'Garchomp' }, { name: 'Gliscor' }];

function staggerOf(): string | undefined {
  const html = renderToStaticMarkup(
    <Table columns={columns} data={data} keyExtractor={(row) => row.name} animated hidePagination />,
  );
  return /data-stagger="([^"]*)"/.exec(html)?.[1];
}

beforeEach(() => {
  state.reduced = false;
});

describe('Table stagger', () => {
  it('staggers the rows by default', () => {
    expect(staggerOf()).toBe(String(STAGGER.mobile));
  });

  it('shows every row at once under reduced motion', () => {
    state.reduced = true;
    expect(staggerOf()).toBe('0');
  });
});
