import { describe, expect, it, vi } from 'vitest';
import { SLUG_PATTERN } from '../keys';
import { insertWithSlug } from '../insert-with-slug.server';

class Taken extends Error {}
const isTaken = (error: unknown) => error instanceof Taken;

/** An insert that refuses the first `taken` slugs it is offered and records every offer. */
function inserter(taken: number) {
  const offered: string[] = [];
  const create = vi.fn(async (slug: string) => {
    offered.push(slug);
    if (offered.length <= taken) throw new Taken(slug);
    return { slug };
  });
  return { create, offered };
}

describe('insertWithSlug', () => {
  it('uses the base slug when it is free', async () => {
    const { create, offered } = inserter(0);
    expect(await insertWithSlug(create, isTaken, { base: 'spring-ou' })).toEqual({ slug: 'spring-ou' });
    expect(offered).toEqual(['spring-ou']);
  });

  it('offers -2 to -9 and then a random four-digit hex suffix', async () => {
    const { create, offered } = inserter(9);
    const result = await insertWithSlug(create, isTaken, { base: 'spring-ou' });
    expect(offered.slice(0, 9)).toEqual(['spring-ou', 'spring-ou-2', 'spring-ou-3', 'spring-ou-4', 'spring-ou-5', 'spring-ou-6', 'spring-ou-7', 'spring-ou-8', 'spring-ou-9']);
    expect(result.slug).toMatch(/^spring-ou-[0-9a-f]{4}$/);
    expect(result.slug).toMatch(SLUG_PATTERN);
  });

  it('gives up with the last "taken" error after the last resort', async () => {
    const { create, offered } = inserter(100);
    await expect(insertWithSlug(create, isTaken, { base: 'spring-ou' })).rejects.toBeInstanceOf(Taken);
    expect(offered).toHaveLength(10);
  });

  it('an explicit slug is tried once and its "taken" error is the answer', async () => {
    const { create, offered } = inserter(1);
    await expect(insertWithSlug(create, isTaken, { explicit: 'mine' })).rejects.toBeInstanceOf(Taken);
    expect(offered).toEqual(['mine']);
  });

  it('any other failure stops at once', async () => {
    const create = vi.fn(async () => {
      throw new Error('database down');
    });
    await expect(insertWithSlug(create, isTaken, { base: 'x' })).rejects.toThrow('database down');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
