// An in-memory CacheStorage and a scripted network, for the service worker's
// tests (Cookpool PW-4). Entries are keyed by URL; what was put is kept with
// the request it was put under, so a test can see that no header was stored.

export interface FakeEntry {
  request: Request;
  response: Response;
}

export class FakeCache {
  readonly entries = new Map<string, FakeEntry>();
  private key(request: RequestInfo | URL): string {
    return typeof request === "string" ? new URL(request).href : request instanceof URL ? request.href : request.url;
  }
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const hit = this.entries.get(this.key(request));
    return hit ? hit.response.clone() : undefined;
  }
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const req = typeof request === "string" || request instanceof URL ? new Request(this.key(request)) : request;
    // A put moves the entry to the end, like the Cache API.
    this.entries.delete(this.key(request));
    this.entries.set(this.key(request), { request: req, response: response.clone() });
  }
  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.key(request));
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.values()].map((e) => e.request);
  }
}

export class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let c = this.stores.get(name);
    if (!c) {
      c = new FakeCache();
      this.stores.set(name, c);
    }
    return c;
  }
  async has(name: string): Promise<boolean> {
    return this.stores.has(name);
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
  async match(request: RequestInfo | URL, opts: { cacheName?: string } = {}): Promise<Response | undefined> {
    const names = opts.cacheName ? [opts.cacheName] : [...this.stores.keys()];
    for (const name of names) {
      const hit = await this.stores.get(name)?.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
  /** What a cache holds, by URL, as text. */
  async text(name: string, url: string): Promise<string | undefined> {
    return (await this.stores.get(name)?.match(url))?.text();
  }
}

/** A network that answers from a table (a function), or fails like no signal. */
export function fakeNetwork(answer: (request: Request) => Response | Promise<Response>) {
  const seen: Request[] = [];
  let offline = false;
  const fetch = async (request: Request): Promise<Response> => {
    seen.push(request);
    if (offline) throw new TypeError("Failed to fetch");
    return answer(request);
  };
  return {
    fetch,
    seen,
    goOffline: () => {
      offline = true;
    },
    goOnline: () => {
      offline = false;
    },
  };
}

/** A promise's settled value after the microtasks (and the fake timers) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
