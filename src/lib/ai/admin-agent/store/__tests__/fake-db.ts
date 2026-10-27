/**
 * A recording stand-in for the service-role client: every `from(table)...` chain is captured as a `RecordedCall`
 * (operation, payload, filters), and a scripted reply answers it. `npm run test` never reaches a database.
 */
import type { AdminAgentDb } from '../context';

type Step = [string, ...unknown[]];

export interface RecordedCall {
  table: string;
  /** The first of insert, update, upsert, delete in the chain, else select. */
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  payload?: unknown;
  steps: Step[];
  terminal: 'maybeSingle' | 'single' | 'list';
}

export interface Reply {
  data?: unknown;
  count?: number | null;
  error?: unknown;
}

interface Script {
  match: (call: RecordedCall) => boolean;
  reply: Reply | ((call: RecordedCall) => Reply);
  once: boolean;
}

export interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/** The value of the first `.eq(column, value)` step on `column`, or `undefined`. */
export function eqOf(call: RecordedCall, column: string): unknown {
  return call.steps.find((s) => s[0] === 'eq' && s[1] === column)?.[2];
}

/** Whether the chain has the step `name(...args)`. */
export function hasStep(call: RecordedCall, name: string, ...args: unknown[]): boolean {
  return call.steps.some((s) => s[0] === name && args.every((a, i) => JSON.stringify(s[i + 1]) === JSON.stringify(a)));
}

export class FakeDb {
  readonly calls: RecordedCall[] = [];
  readonly rpcCalls: RpcCall[] = [];
  private readonly scripts: Script[] = [];
  private readonly rpcScripts: Array<{ name: string; reply: Reply | ((args: Record<string, unknown>) => Reply); once: boolean }> = [];

  /** Answers every call that `match` accepts (first match wins; `once` consumes the script). */
  when(match: (call: RecordedCall) => boolean, reply: Reply | ((call: RecordedCall) => Reply), once = false): this {
    this.scripts.push({ match, reply, once });
    return this;
  }

  /** `when` for a table and operation. */
  on(table: string, op: RecordedCall['op'], reply: Reply | ((call: RecordedCall) => Reply), once = false): this {
    return this.when((c) => c.table === table && c.op === op, reply, once);
  }

  onRpc(name: string, reply: Reply | ((args: Record<string, unknown>) => Reply), once = false): this {
    this.rpcScripts.push({ name, reply, once });
    return this;
  }

  /** Calls recorded against `table` (optionally one operation). */
  to(table: string, op?: RecordedCall['op']): RecordedCall[] {
    return this.calls.filter((c) => c.table === table && (op === undefined || c.op === op));
  }

  private answer(call: RecordedCall): Reply {
    const index = this.scripts.findIndex((s) => s.match(call));
    if (index === -1) return { data: call.terminal === 'list' ? [] : null, error: null };
    const script = this.scripts[index];
    if (script.once) this.scripts.splice(index, 1);
    return typeof script.reply === 'function' ? script.reply(call) : script.reply;
  }

  from = (table: string) => {
    const call: RecordedCall = { table, op: 'select', steps: [], terminal: 'list' };
    this.calls.push(call);
    const chain: Record<string, unknown> = {};
    const settle = (terminal: RecordedCall['terminal']) => {
      call.terminal = terminal;
      const reply = this.answer(call);
      return { data: null, count: null, error: null, ...reply };
    };
    for (const name of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'or', 'order', 'range', 'limit']) {
      chain[name] = (...args: unknown[]) => {
        call.steps.push([name, ...args]);
        if ((name === 'insert' || name === 'update' || name === 'upsert' || name === 'delete') && call.op === 'select') {
          call.op = name;
          call.payload = args[0];
        }
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve().then(() => settle('maybeSingle'));
    chain.single = () => Promise.resolve().then(() => settle('single'));
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => settle('list'))
        .then(resolve, reject);
    return chain;
  };

  rpc = (name: string, args: Record<string, unknown>) => {
    this.rpcCalls.push({ name, args });
    const index = this.rpcScripts.findIndex((s) => s.name === name);
    let reply: Reply = { data: null, error: null };
    if (index !== -1) {
      const script = this.rpcScripts[index];
      if (script.once) this.rpcScripts.splice(index, 1);
      reply = typeof script.reply === 'function' ? script.reply(args) : script.reply;
    }
    return Promise.resolve({ data: null, error: null, ...reply });
  };

  /** The client the store is built over. */
  get client(): AdminAgentDb {
    return this as unknown as AdminAgentDb;
  }
}

export const ADMIN = '11111111-1111-4111-8111-111111111111';
export const OTHER_ADMIN = '22222222-2222-4222-8222-222222222222';
export const CONVERSATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const PLAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const PROPOSAL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const ACTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const USAGE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const HASH = 'a'.repeat(64);
export const NOW = new Date('2026-10-27T12:00:00.000Z');

/** The ownership row `ownedConversation` reads. */
export function ownedRow(overrides: Record<string, unknown> = {}) {
  return { id: CONVERSATION, admin_id: ADMIN, admin_name: 'Test Admin', seq_head: 0, status: 'active', ...overrides };
}

/** Makes the conversation `CONVERSATION` belong to `ADMIN` (and to nobody else). */
export function ownsConversation(db: FakeDb, overrides: Record<string, unknown> = {}): FakeDb {
  return db.when((c) => c.table === 'admin_agent_conversations' && c.op === 'select' && eqOf(c, 'id') === CONVERSATION && eqOf(c, 'admin_id') === ADMIN, {
    data: ownedRow(overrides),
  });
}
