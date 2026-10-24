export type Fetcher = typeof fetch;

let current: Fetcher = globalThis.fetch.bind(globalThis);

export function setContactFetcher(fetcher: Fetcher) {
  current = fetcher;
}

export function resetContactFetcher() {
  current = globalThis.fetch.bind(globalThis);
}

export function contactFetch(input: RequestInfo | URL, init?: RequestInit) {
  return current(input, init);
}
