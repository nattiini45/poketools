import type { Slug } from '../keys';
import type { FormatDefinition } from '../types';
import { classicLeague } from './classic-league';
import { cup } from './cup';
import { swissTopCut } from './swiss-top-cut';

export { classicLeague, cup, swissTopCut };

/** The preset definitions, in gallery order. Every preset compiles without errors against the current environment. */
export const PRESETS: ReadonlyArray<{ id: Slug; definition: FormatDefinition }> = [
  { id: 'classic-league', definition: classicLeague },
  { id: 'cup', definition: cup },
  { id: 'swiss-top-cut', definition: swissTopCut },
];
