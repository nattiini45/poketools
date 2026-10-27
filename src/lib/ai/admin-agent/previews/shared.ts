import 'server-only';
/**
 * Pieces the preview tools share: a preflight result is a list of BLOCKERS (the Build or card would be refused or would
 * misbehave) and WARNINGS, each a catalogued code plus fenced params, never the text of a thrown error.
 */
import { z } from 'zod';
import { toolErrorFromThrown } from '../registry/errors';
import { code, userText } from '../registry/atoms';
import { fenceText } from '../registry/fence';

export const finding = z.strictObject({ code: code(), params_user_text: userText() });
export type Finding = z.infer<typeof finding>;

const asFinding = (errorCode: string, params?: Readonly<Record<string, string | number>>): Finding => ({
  code: errorCode,
  params_user_text: fenceText(params === undefined ? '' : JSON.stringify(params)),
});

/** Runs a check that throws a coded error when it refuses; the refusal becomes a finding, anything unexpected too. */
export async function check(where: string, run: () => unknown): Promise<Finding | null> {
  try {
    await run();
    return null;
  } catch (err) {
    const mapped = toolErrorFromThrown(err, where);
    return asFinding(mapped.code, mapped.params);
  }
}

export const finder = asFinding;
