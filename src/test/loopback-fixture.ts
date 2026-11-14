import type { Server } from 'node:net';

const endpoints = new Set<string>();

export function allowLoopbackFixture(server: Server): void {
  const address = server.address();
  if (!server.listening || !address || typeof address === 'string' || !['127.0.0.1', '::1'].includes(address.address)) {
    throw new Error('[unit-isolation] a fixture must own a listening loopback TCP server');
  }
  const endpoint = `${address.address}:${address.port}`;
  endpoints.add(endpoint);
  server.once('close', () => endpoints.delete(endpoint));
}

export function isLoopbackFixture(host: unknown, port: unknown): boolean {
  return typeof host === 'string' && endpoints.has(`${host.replace(/^\[|\]$/g, '')}:${port}`);
}
