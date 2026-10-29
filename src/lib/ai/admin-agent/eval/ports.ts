/**
 * Model ports for the harness (plan 7.1 stage 1, 7.2): a replay port that plays a recording, a tally wrapper that counts
 * what any port did, and the helpers that turn a live step into a recording.
 *
 * The replay port is the deterministic self-test's "model": it makes the same `step` call the AI SDK port does and returns
 * the blocks a recording describes, so the real loop, the real tool-argument parsing and the fixture world all run, and only
 * the provider is scripted. It runs offline and costs nothing. A recording is also what a live run can write
 * (`--record`), so a sound live transcript becomes a regression case without hand-writing it.
 */
import type { AssistantBlock } from '../loop/blocks';
import { ModelPortError, type AdminModelPort, type ModelCompleteInput, type ModelCompleteResult, type ModelStepInput, type ModelStepResult, type StopReason } from '../loop/types';
import type { Json, UsageMeters } from '../store/types';
import type { RecordedStep, Recording, UsageTotals } from './types';

const NONE: UsageMeters = { inputTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, outputTokens: 0 };

/** The replay port ran out of recorded steps: the loop wanted a model call the recording does not have. */
export class RecordingExhaustedError extends Error {
  constructor() {
    super('admin-agent eval: the recording has no step left for this model call');
    this.name = 'RecordingExhaustedError';
  }
}

/** Plausible meters for a step when the recording gives none: the first request writes the cache, later ones read it. */
function defaultMeters(requestIndex: number, calls: number): UsageMeters {
  const base = requestIndex === 0 ? { cacheWrite1hTokens: 7_000, cacheReadTokens: 0, inputTokens: 900 } : { cacheWrite1hTokens: 0, cacheReadTokens: 7_000 + requestIndex * 400, inputTokens: 350 };
  return { ...NONE, ...base, outputTokens: 140 + calls * 70 };
}

export interface ReplayOptions {
  /** Resolves `{{placeholder}}` tokens in tool inputs (the world's ids). */
  resolve: <T>(value: T) => T;
}

/** Plays `recording` turn by turn. Call `beginTurn(i)` before the loop runs turn `i`. */
export class ReplayPort implements AdminModelPort {
  private turn = -1;
  private queue: RecordedStep[] = [];
  private requests = 0;
  private toolSeq = 0;
  private thinkSeq = 0;
  /** True once the loop asked for a step the recording does not have. */
  exhausted = false;

  constructor(
    private readonly recording: Recording,
    private readonly options: ReplayOptions,
  ) {}

  beginTurn(index: number): void {
    this.turn = index;
    this.queue = [...(this.recording.turns[index] ?? [])];
  }

  /** Steps of the current turn that were never played (a recording longer than the run needed). */
  get unplayed(): number {
    return this.queue.length;
  }

  async step(input: ModelStepInput): Promise<ModelStepResult> {
    const spec = this.queue.shift();
    if (spec === undefined) {
      this.exhausted = true;
      throw new RecordingExhaustedError();
    }
    const blocks: AssistantBlock[] = [];
    const calls = spec.calls ?? [];
    if (spec.thinking ?? calls.length > 0) blocks.push({ type: 'thinking', thinking: 'Considering the request and the available tools.', signature: `eval-sig-${++this.thinkSeq}` });
    if (spec.text !== undefined) blocks.push({ type: 'text', text: spec.text });
    for (const call of calls) {
      blocks.push({ type: 'tool_use', id: `toolu_eval_${++this.toolSeq}`, name: call.name, input: this.options.resolve(call.input) as Json });
    }
    if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
    if (spec.text !== undefined) input.onTextDelta?.(spec.text);

    const stopReason: StopReason = spec.stop === 'refusal' ? 'refusal' : spec.stop === 'max_tokens' ? 'max_tokens' : calls.length > 0 ? 'tool_use' : 'end_turn';
    const defaults = defaultMeters(this.requests, calls.length);
    this.requests += 1;
    const usage: UsageMeters = {
      inputTokens: spec.usage?.input ?? defaults.inputTokens,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: spec.usage?.cacheWrite ?? defaults.cacheWrite1hTokens,
      cacheReadTokens: spec.usage?.cacheRead ?? defaults.cacheReadTokens,
      outputTokens: spec.usage?.output ?? defaults.outputTokens,
    };
    return {
      blocks,
      toolCalls: blocks.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [])),
      stopReason,
      rawStopReason: stopReason,
      usage,
      model: input.model,
    };
  }

  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    return { text: 'Eval conversation', usage: { ...NONE, inputTokens: 100, outputTokens: 5 }, model: input.model };
  }
}

/** Wraps a port and counts what it did: requests, tokens, stops, and the thinking blocks it produced. */
export class TallyPort implements AdminModelPort {
  readonly usage: UsageTotals = { modelRequests: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, warmInputTokens: 0, warmCacheReadTokens: 0, warmCacheWriteTokens: 0 };
  readonly stops: StopReason[] = [];
  readonly signatures: string[] = [];
  /** Every step result, in order, for `--record`. */
  readonly results: ModelStepResult[] = [];
  failures = 0;

  constructor(private readonly inner: AdminModelPort) {}

  async step(input: ModelStepInput): Promise<ModelStepResult> {
    const warm = this.usage.modelRequests >= 1;
    this.usage.modelRequests += 1;
    try {
      const result = await this.inner.step(input);
      const written = result.usage.cacheWrite5mTokens + result.usage.cacheWrite1hTokens;
      this.usage.inputTokens += result.usage.inputTokens;
      this.usage.cacheReadTokens += result.usage.cacheReadTokens;
      this.usage.cacheWriteTokens += written;
      this.usage.outputTokens += result.usage.outputTokens;
      if (warm) {
        this.usage.warmInputTokens += result.usage.inputTokens;
        this.usage.warmCacheReadTokens += result.usage.cacheReadTokens;
        this.usage.warmCacheWriteTokens += written;
      }
      this.stops.push(result.stopReason);
      for (const block of result.blocks) if (block.type === 'thinking') this.signatures.push(block.signature);
      this.results.push(result);
      return result;
    } catch (error) {
      this.failures += 1;
      throw error;
    }
  }

  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    return this.inner.complete(input);
  }
}

/** A live step as a recorded one (thinking text and signatures are not kept; a replay writes placeholders). */
export function stepFromResult(result: ModelStepResult): RecordedStep {
  const text = result.blocks.flatMap((b) => (b.type === 'text' && b.text !== '' ? [b.text] : [])).join('');
  const calls = result.blocks.flatMap((b) => (b.type === 'tool_use' ? [{ name: b.name, input: (b.input ?? {}) as Record<string, Json> }] : []));
  return {
    ...(text !== '' ? { text } : {}),
    ...(result.blocks.some((b) => b.type === 'thinking') ? { thinking: true } : {}),
    ...(calls.length > 0 ? { calls } : {}),
    ...(result.stopReason === 'max_tokens' || result.stopReason === 'refusal' ? { stop: result.stopReason } : {}),
    usage: {
      input: result.usage.inputTokens,
      cacheRead: result.usage.cacheReadTokens,
      cacheWrite: result.usage.cacheWrite5mTokens + result.usage.cacheWrite1hTokens,
      output: result.usage.outputTokens,
    },
  };
}

/** A port whose every call fails the way an unreachable provider does. Used to prove a run reports it instead of hanging. */
export function failingPort(kind: ConstructorParameters<typeof ModelPortError>[0] = 'unavailable'): AdminModelPort {
  return {
    async step() {
      throw new ModelPortError(kind);
    },
    async complete() {
      throw new ModelPortError(kind);
    },
  };
}
