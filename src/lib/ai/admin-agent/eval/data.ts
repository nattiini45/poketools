/**
 * Loads the case files and the recordings, parses them with their schemas and checks the references between them.
 *
 * Cases (`cases/*.json`) say what a conversation is and what must happen; recordings (`recordings/*.json`, keyed by case
 * id) are what a deterministic run replays as the model. A case without a recording cannot run offline; a recording without
 * a case is dead data. Both are errors here, so the self-test fails the day one is added without the other.
 */
import roCases from './cases/ro.json';
import sfCases from './cases/sf.json';
import roRecordings from './recordings/ro.json';
import sfRecordings from './recordings/sf.json';
import { caseSchema, recordingsFileSchema, type EvalCase, type Recording } from './types';

export function loadCases(): EvalCase[] {
  const cases = [...(roCases as unknown[]), ...(sfCases as unknown[])].map((raw) => caseSchema.parse(raw));
  validateCases(cases);
  return cases;
}

export function loadRecordings(): Record<string, Recording> {
  return { ...recordingsFileSchema.parse(roRecordings), ...recordingsFileSchema.parse(sfRecordings) };
}

/** Throws on a duplicate id, a twin that does not point at an English case of the same shape, or a recording mismatch. */
export function validateCases(cases: readonly EvalCase[], recordings: Readonly<Record<string, Recording>> = loadRecordings()): void {
  const byId = new Map<string, EvalCase>();
  for (const testCase of cases) {
    if (byId.has(testCase.id)) throw new Error(`eval: duplicate case id ${testCase.id}`);
    byId.set(testCase.id, testCase);
  }
  for (const testCase of cases) {
    if (testCase.twinOf !== undefined) {
      const original = byId.get(testCase.twinOf);
      if (original === undefined) throw new Error(`eval: ${testCase.id} is the twin of unknown case ${testCase.twinOf}`);
      if (original.locale !== 'en' || testCase.locale !== 'de') throw new Error(`eval: ${testCase.id} must be a German twin of an English case`);
      for (const key of ['area', 'phase', 'actor', 'fixture', 'clock'] as const) {
        if (original[key] !== testCase[key]) throw new Error(`eval: ${testCase.id} differs from its original in ${key}`);
      }
      if (original.turns.length !== testCase.turns.length) throw new Error(`eval: ${testCase.id} has another number of turns than ${original.id}`);
    }
    const recording = recordings[testCase.id];
    if (recording === undefined) throw new Error(`eval: no recording for case ${testCase.id}`);
    if (recording.turns.length !== testCase.turns.length) throw new Error(`eval: the recording of ${testCase.id} has ${recording.turns.length} turns, the case ${testCase.turns.length}`);
  }
  for (const id of Object.keys(recordings)) if (!byId.has(id)) throw new Error(`eval: recording ${id} has no case`);
}

/** Cases whose id equals one of `selectors` or starts with it followed by `-` or a digit boundary (`RO` selects every RO case, `RO1` selects RO1 and RO1-DE). */
export function selectCases(cases: readonly EvalCase[], selectors: readonly string[]): EvalCase[] {
  if (selectors.length === 0) return [...cases];
  const picked = cases.filter((testCase) => selectors.some((selector) => testCase.id === selector || testCase.id.startsWith(`${selector}-`) || (/^[A-Z]+$/.test(selector) && testCase.id.startsWith(selector))));
  const unknown = selectors.filter((selector) => !cases.some((c) => c.id === selector || c.id.startsWith(`${selector}-`) || (/^[A-Z]+$/.test(selector) && c.id.startsWith(selector))));
  if (unknown.length > 0) throw new Error(`eval: no case matches ${unknown.join(', ')}`);
  return picked;
}
