/**
 * A small in-memory CacheStorage for the worker tests: entries are keyed by request URL, `match` finds the first cache
 * (in creation order) that holds one, and a failing `delete` can be switched on.
 */

export class FakeCache {
  readonly entries = new Map<string, Response>();

  constructor(
    private readonly onDeleteFailure: () => boolean,
    private readonly fetcher: (url: string) => Promise<Response>,
  ) {}

  async put(request: Request | string, response: Response): Promise<void> {
    this.entries.set(urlOf(request), response);
  }

  async add(request: Request | string): Promise<void> {
    const response = await this.fetcher(new URL(urlOf(request)).href);
    if (!response.ok) throw new TypeError('bad response status');
    this.entries.set(urlOf(request), response);
  }

  async addAll(requests: Array<Request | string>): Promise<void> {
    await Promise.all(requests.map((request) => this.add(request)));
  }

  async match(request: Request | string): Promise<Response | undefined> {
    return this.entries.get(urlOf(request))?.clone();
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async delete(request: Request | string): Promise<boolean> {
    if (this.onDeleteFailure()) throw new Error('blocked');
    return this.entries.delete(urlOf(request));
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  failDeletes = false;
  /** What cache.add fetches with; a test points it at its fake network. */
  fetcher: (url: string) => Promise<Response> = async () => new Response('x');

  constructor(private readonly origin = 'https://poketools.test') {}

  private resolve(request: Request | string): string {
    return new URL(typeof request === 'string' ? request : request.url, this.origin).href;
  }

  async open(name: string): Promise<FakeCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache(() => this.failDeletes, (url) => this.fetcher(url));
      this.stores.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async delete(name: string): Promise<boolean> {
    if (this.failDeletes) throw new Error('blocked');
    return this.stores.delete(name);
  }

  async match(request: Request | string): Promise<Response | undefined> {
    for (const cache of this.stores.values()) {
      const hit = await cache.match(this.resolve(request));
      if (hit) return hit;
    }
    return undefined;
  }

  /** Every cached URL, as `name → paths`, for assertions. */
  paths(): Record<string, string[]> {
    return Object.fromEntries(
      [...this.stores].map(([name, cache]) => [name, [...cache.entries.keys()].map((url) => new URL(url).pathname).sort()]),
    );
  }
}

function urlOf(request: Request | string): string {
  const raw = typeof request === 'string' ? request : request.url;
  return new URL(raw, 'https://poketools.test').href;
}
