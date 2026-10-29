import { describe, expect, it, vi } from 'vitest';
import { createBindingRegistry } from '../../dispatch/binding';
import { createToolRuntime } from '../tool-runtime';
import type { ToolCallContext } from '../types';
import { ADMIN, CONVERSATION_ID, fakeToolSet } from './fakes';

const ID = '00000000-0000-4000-8000-0000000000aa';
const ctx = { adminId: ADMIN, conversationId: CONVERSATION_ID, now: () => new Date(), timeZone: 'Europe/Berlin', locale: 'en' } as unknown as ToolCallContext;
const set = fakeToolSet({ league_get: 'R', plan_validate: 'P', plan_set: 'D' });

describe('createToolRuntime: the ids a read returned (provenance, plan 6.3)', () => {
  it('attaches the ids the reader finds in the result of an R or P tool, and only for a successful one', async () => {
    const runTool = vi.fn(async (_set, name: string) => (name === 'plan_validate' ? { ok: false as const, code: 'forbidden' as const } : { ok: true as const, data: { id: ID } }));
    const resultRefs = vi.fn(() => [{ kind: 'league', id: ID, label: null, source: 'tool_result' as const }]);
    const runtime = createToolRuntime({ runTool: runTool as never, ports: {}, ops: createBindingRegistry([]), resultRefs });

    expect(await runtime.run(set, { name: 'league_get', input: {} }, ctx)).toEqual({ ok: true, data: { id: ID }, refs: [{ kind: 'league', id: ID, label: null, source: 'tool_result' }] });
    expect(resultRefs).toHaveBeenCalledWith(set.definitions.get('league_get'), { id: ID });
    expect(await runtime.run(set, { name: 'plan_validate', input: {} }, ctx)).toEqual({ ok: false, code: 'forbidden' });
    expect(resultRefs).toHaveBeenCalledTimes(1);
  });

  it('leaves the result as it is when no reader is injected, and when the reader throws', async () => {
    const runTool = vi.fn(async () => ({ ok: true as const, data: { id: ID } }));
    const plain = createToolRuntime({ runTool: runTool as never, ports: {}, ops: createBindingRegistry([]) });
    expect(await plain.run(set, { name: 'league_get', input: {} }, ctx)).toEqual({ ok: true, data: { id: ID } });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = createToolRuntime({
      runTool: runTool as never,
      ports: {},
      ops: createBindingRegistry([]),
      resultRefs: () => {
        throw new Error('boom');
      },
    });
    expect(await broken.run(set, { name: 'league_get', input: {} }, ctx)).toEqual({ ok: true, data: { id: ID } });
    spy.mockRestore();
  });

  it('never reads ids out of a staged tool (its runner answers for itself)', async () => {
    const resultRefs = vi.fn(() => []);
    const runStaged = vi.fn(async () => ({ ok: true as const, data: {} }));
    const runtime = createToolRuntime({ runTool: vi.fn() as never, ports: {}, ops: createBindingRegistry([]), resultRefs, runStaged });
    await runtime.run(set, { name: 'plan_set', input: {} }, ctx);
    expect(runStaged).toHaveBeenCalledTimes(1);
    expect(resultRefs).not.toHaveBeenCalled();
  });
});
