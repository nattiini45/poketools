/**
 * The onError wiring of the shared sprite components (docs/pkmn.md, "Sprite
 * styles"): a load error on the rendered image steps its src to the next
 * candidate of the fallback chain and stops at the placeholder.
 *
 * The repo has no DOM test environment (no jsdom), so this drives the
 * components as plain functions with a minimal hook shim: `useState` keeps one
 * slot per test, `useMemo` runs its factory, `useContext` returns the context
 * default (no provider: the site default style). The image element the
 * component returns is real, so its own `onError` prop is what gets called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const hooks = vi.hoisted(() => ({ slot: undefined as unknown }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = <T,>(init: T | (() => T)) => {
    if (hooks.slot === undefined) hooks.slot = typeof init === 'function' ? (init as () => T)() : init;
    const set = (next: T | ((prev: T) => T)) => {
      hooks.slot = typeof next === 'function' ? (next as (prev: T) => T)(hooks.slot as T) : next;
    };
    return [hooks.slot as T, set] as const;
  };
  const useMemo = <T,>(factory: () => T) => factory();
  const useContext = (ctx: { _currentValue: unknown }) => ctx._currentValue;
  return { ...actual, default: { ...actual, useState, useMemo, useContext }, useState, useMemo, useContext };
});

import { SPRITE_PLACEHOLDER_URL, spriteResolver } from '@/lib/pkmn/sprite-styles';
import PokemonSprite from '../PokemonSprite';
import SpriteImg from '../SpriteImg';

type ImgProps = { src: string; onError: () => void };

/** Renders an outer component, then its keyed inner component, to the image element. */
function renderImage(element: ReactElement): ReactElement<ImgProps> {
  let node: ReactElement = element;
  // Unwrap function components until a host element or next/image is reached.
  for (let i = 0; i < 4; i += 1) {
    const props = node.props as Record<string, unknown>;
    if (typeof props.src === 'string' && typeof props.onError === 'function') return node as ReactElement<ImgProps>;
    const type = node.type as (p: unknown) => ReactElement;
    node = type(props);
  }
  throw new Error('no image element with onError found');
}

beforeEach(() => {
  hooks.slot = undefined;
});

describe('SpriteImg onError', () => {
  it('steps down the pixel chain on each error and stays on the placeholder', () => {
    const candidates = spriteResolver.candidates('Garchomp', 'pixel', { variant: 'thumb' });
    expect(candidates.length).toBeGreaterThan(2);
    const element = <SpriteImg name="Garchomp" alt="" spriteStyle="pixel" />;
    const seen: string[] = [];
    for (let i = 0; i < candidates.length + 1; i += 1) {
      const img = renderImage(element);
      seen.push(img.props.src);
      img.props.onError();
    }
    expect(seen.slice(0, candidates.length)).toEqual(candidates);
    expect(seen.at(-1)).toBe(SPRITE_PLACEHOLDER_URL);
  });
});

describe('PokemonSprite onError', () => {
  it('a failed animated sprite falls back to the next candidate (HOME)', () => {
    const candidates = spriteResolver.candidates('Garchomp', 'animated', { variant: 'thumb' });
    const element = <PokemonSprite name="Garchomp" spriteStyle="animated" />;
    const first = renderImage(element);
    expect(first.props.src).toBe(candidates[0]);
    first.props.onError();
    expect(renderImage(element).props.src).toBe(candidates[1]);
  });
});
