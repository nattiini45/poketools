/**
 * Route faults of the local-stack stages (plan 7.3 LG10, "fault injection: phase 2 route commits then answers a masked 500").
 *
 * tsx has no `vi.mock`, so the fault is installed on the binding the executor dispatches: the registry hands out the binding
 * OBJECTS (`getBindingRegistry().get(op)`), and a binding's `load()` is the one place the route module is reached. Wrapping it
 * leaves the route, the dispatch layer, the executor and its read-back untouched: the handler is the real one, only the response
 * (or the moment of its commit) is changed.
 *
 *  - `commit_then_500`: the real handler runs to its end, then the response is replaced by a masked 500. The write is committed;
 *    the executor's read-back finds it and adopts it in the same request.
 *  - `late_commit_500`: the response is a masked 500 at once and the real handler starts only when `release()` is called (inside
 *    the async context the dispatch captured, so the verified session and the audit context still apply). The read-back finds
 *    nothing (`unknown`), the Build stays `executing`, and a resume after `release()` finds the write and adopts it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { BindingRegistry, RouteBinding } from '@/lib/ai/admin-agent/dispatch';
import type { RouteFault } from '@/lib/ai/admin-agent/eval/types';

type Handler = (request: never, context: never) => Response | Promise<Response>;
type Loadable = { load: () => Promise<Record<string, unknown>> };

const maskedFiveHundred = (): Response =>
  new Response(JSON.stringify({ success: false, error: 'An unexpected error occurred.' }), { status: 500, headers: { 'content-type': 'application/json' } });

export interface InstalledFaults {
  /** Runs the held-back commits of `late_commit_500` faults and waits until they have finished. */
  release(): Promise<void>;
  /** How many times each faulted op's route was called (the fault fires on the Nth). */
  calls(): Record<string, number>;
  /** Puts every binding back. */
  restore(): void;
}

export function installRouteFaults(registry: Pick<BindingRegistry, 'get'>, faults: readonly RouteFault[]): InstalledFaults {
  const originals: Array<{ binding: Loadable; load: Loadable['load'] }> = [];
  const held: Array<{ run: () => Promise<void> }> = [];
  const counts: Record<string, number> = {};

  for (const fault of faults) {
    const binding = registry.get(fault.op);
    if (binding === undefined) throw new Error(`admin-agent eval: route fault names an op without a binding (${fault.op})`);
    const target = binding as unknown as Loadable;
    const method = (binding as RouteBinding).method;
    const original = target.load;
    originals.push({ binding: target, load: original });
    counts[fault.op] = 0;
    target.load = async () => {
      const routeModule = await original.call(binding);
      const handler = routeModule[method] as Handler | undefined;
      if (typeof handler !== 'function') return routeModule;
      const faulty = async (request: never, context: never): Promise<Response> => {
        counts[fault.op] += 1;
        if (counts[fault.op] !== fault.nth) return handler(request, context);
        if (fault.mode === 'commit_then_500') {
          await handler(request, context);
          return maskedFiveHundred();
        }
        // Keep the async context of this dispatch (verified session, audit scope) for the commit that happens later.
        const inContext = AsyncLocalStorage.snapshot();
        held.push({ run: async () => void (await inContext(() => handler(request, context))) });
        return maskedFiveHundred();
      };
      return { ...routeModule, [method]: faulty };
    };
  }

  return {
    async release() {
      const pending = held.splice(0);
      for (const entry of pending) await entry.run();
    },
    calls: () => ({ ...counts }),
    restore() {
      for (const { binding, load } of originals) binding.load = load;
      originals.length = 0;
    },
  };
}
