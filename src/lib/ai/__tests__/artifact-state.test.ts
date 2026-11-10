import { describe, expect, it } from 'vitest';
import { aiArtifactMachine } from '../artifact-state';

describe('aiArtifactMachine', () => {
  it('settles only a pending row', () => {
    expect(aiArtifactMachine.sourcesOf('completed')).toEqual(['pending']);
    expect(aiArtifactMachine.sourcesOf('failed')).toEqual(['pending']);
  });

  it('never moves a settled row back to pending: a regenerate deletes it first', () => {
    expect(aiArtifactMachine.sourcesOf('pending')).toEqual(['absent']);
    expect(aiArtifactMachine.can('completed', 'failed', 'system')).toBe(false);
    expect(aiArtifactMachine.can('failed', 'completed', 'system')).toBe(false);
  });

  it('declares the three stored states the tables use', () => {
    expect(aiArtifactMachine.spec.states.filter((s) => s !== 'absent')).toEqual(['pending', 'completed', 'failed']);
  });
});
