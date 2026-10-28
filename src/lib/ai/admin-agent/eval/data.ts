/**
 * Loads the case files and the recordings, parses them with their schemas and checks the references between them.
 *
 * Cases (`cases/*.json`) say what a conversation is and what must happen; recordings (`recordings/*.json`, keyed by case
 * id) are what a deterministic run replays as the model. A case without a recording cannot run offline; a recording without
 * a case is dead data. Both are errors here, so the self-test fails the day one is added without the other. The one exception
 * is an `e2e` case, which is written for the real model: it may carry a recording (`--port replay` then plays it) but needs none.
 *
 * Two sets: the phase 0 set (`ro.json`, `sf.json`; `loadCases`, `loadRecordings`) that the plan stage and its self-test run
 * unchanged, and the P1 set (`p1.json`; `loadP1Cases`, `loadP1Recordings`): plan cases that need the phase 1 tool set, and the
 * `exec` and `e2e` cases of the local-stack stages. `loadAllCases` is both.
 */
import p1Cases from './cases/p1.json';
import roCases from './cases/ro.json';
import sfCases from './cases/sf.json';
import p1Recordings from './recordings/p1.json';
import roRecordings from './recordings/ro.json';
import sfRecordings from './recordings/sf.json';
import { caseSchema, recordingsFileSchema, type EvalCase, type EvalStage, type Recording } from './types';

export function loadCases(): EvalCase[] {
  const cases = [...(roCases as unknown[]), ...(sfCases as unknown[])].map((raw) => caseSchema.parse(raw));
  validateCases(cases);
  return cases;
}

export function loadRecordings(): Record<string, Recording> {
  return { ...recordingsFileSchema.parse(roRecordings), ...recordingsFileSchema.parse(sfRecordings) };
}

/** The P1 cases (plan, exec and e2e). */
export function loadP1Cases(): EvalCase[] {
  const cases = (p1Cases as unknown[]).map((raw) => caseSchema.parse(raw));
  validateCases(cases, loadP1Recordings());
  return cases;
}

export function loadP1Recordings(): Record<string, Recording> {
  return recordingsFileSchema.parse(p1Recordings);
}

/** Every case of every file, in file order: the phase 0 set, then the P1 set. */
export function loadAllCases(): EvalCase[] {
  const cases = [...loadCases(), ...loadP1Cases()];
  validateCases(cases, loadAllRecordings());
  return cases;
}

export function loadAllRecordings(): Record<string, Recording> {
  return { ...loadRecordings(), ...loadP1Recordings() };
}

/**
 * The cases a run of `stage` selects when no `--cases` is given: the cases of that stage with a delivery phase up to `phase`, minus
 * the ones marked `blockedBy`. The plan stage at its default phase 0 is exactly the phase 0 suite.
 */
export function casesForStage(cases: readonly EvalCase[], stage: EvalStage, phase: number): EvalCase[] {
  return cases.filter((testCase) => testCase.stage === stage && testCase.phase <= phase && testCase.blockedBy === undefined);
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
    if (recording === undefined) {
      // An end-to-end case is written for the real model; a recording of it is optional.
      if (testCase.stage === 'e2e') continue;
      throw new Error(`eval: no recording for case ${testCase.id}`);
    }
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
