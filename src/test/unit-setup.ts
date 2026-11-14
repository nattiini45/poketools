import { Socket } from 'node:net';
import { afterAll, afterEach } from 'vitest';
import { isolateUnitEnv } from './unit-env';
import { isLoopbackFixture } from './loopback-fixture';

isolateUnitEnv(process.env);

let blocked = 0;
function refuseNetwork(): never {
  blocked += 1;
  throw new Error('[unit-isolation] unmocked network access refused; mock the client or fetch');
}

const originalFetch = globalThis.fetch;
const usageDataset = new URL('https://pkmn.github.io/smogon/data/');
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const publicDataset = method === 'GET' && parsed.origin === usageDataset.origin && parsed.pathname.startsWith(usageDataset.pathname);
    if (!publicDataset && !isLoopbackFixture(parsed.hostname, parsed.port || (parsed.protocol === 'https:' ? '443' : '80'))) refuseNetwork();
  }
  return originalFetch(input, init);
};

const originalConnectKey = Symbol.for('poketools.unit-isolation.original-connect');
if (!Object.getOwnPropertyDescriptor(Socket.prototype, originalConnectKey)) {
  Object.defineProperty(Socket.prototype, originalConnectKey, { value: Socket.prototype.connect });
}
const originalConnect = Object.getOwnPropertyDescriptor(Socket.prototype, originalConnectKey)?.value as Socket['connect'];
Socket.prototype.connect = function (...args: unknown[]) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === 'object' && first !== null ? first as { host?: unknown; port?: unknown } : null;
  const host = options?.host ?? args[1];
  const port = options?.port ?? first;
  if (!(host === usageDataset.hostname && String(port) === '443') && !isLoopbackFixture(host, port)) refuseNetwork();
  return Reflect.apply(originalConnect, this, args);
};

function assertNoNetwork(): void {
  const attempts = blocked;
  blocked = 0;
  if (attempts > 0) {
    throw new Error(`[unit-isolation] ${attempts} unmocked network attempt(s), including errors swallowed by application code`);
  }
}

afterEach(assertNoNetwork);
afterAll(assertNoNetwork);
