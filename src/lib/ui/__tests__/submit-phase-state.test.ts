import { describe, expect, it } from 'vitest';
import { submitPhaseMachine } from '../submit-phase-state';

describe('submitPhaseMachine', () => {
  it('submits from idle and failed only, and never leaves done', () => {
    expect(submitPhaseMachine.sourcesOf('submitting', 'viewer').sort()).toEqual(['failed', 'idle']);
    expect(submitPhaseMachine.nextStates('done')).toEqual([]);
    expect(submitPhaseMachine.nextStates('submitting', 'request').sort()).toEqual(['done', 'failed', 'idle']);
  });
});
