import type { FetchLike } from '../src/index.js';

/**
 * Fixture-serving fetch: serves canned JSON by URL substring and records every
 * request. Tests assert the EXACT wire shape (full JQL/CQL strings, whole PUT
 * bodies) — substring assertions once let a missing `AND` ship green; exact
 * comparison is the point of recording at all.
 */

export interface RouteStep {
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
}

export interface Route extends RouteStep {
  /** Substring the URL must contain. First matching route wins. */
  url: string;
  method?: string;
  throws?: boolean;
  /** Per-call responses in order (pagination, 429-then-ok); the last step repeats once exhausted. */
  seq?: RouteStep[];
}

export interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

export function makeFetch(routes: Route[]): { fetchImpl: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const hits = new Map<Route, number>();
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const route = routes.find((r) => url.includes(r.url) && (!r.method || r.method === method));
    if (!route) throw new Error(`no fixture route for ${method} ${url}`);
    if (route.throws) throw new TypeError('fetch failed');
    const hit = hits.get(route) ?? 0;
    hits.set(route, hit + 1);
    const step = route.seq ? route.seq[Math.min(hit, route.seq.length - 1)]! : route;
    return new Response(JSON.stringify(step.json ?? {}), {
      status: step.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(step.headers ?? {}) },
    });
  };
  return { fetchImpl, calls };
}
