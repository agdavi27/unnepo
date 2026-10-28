import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ServiceError } from "@/lib/errors";

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Job board APIs list every job on the board, so their JSON can be large. */
const MAX_JSON_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;

function privateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateAddress(mapped[1]) : false;
  }
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Rejects anything but public http(s) hosts, so a pasted link can't reach the server's own network. */
export async function assertPublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServiceError("That doesn't look like a link. Paste the full job posting URL, starting with https://", "job_url", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ServiceError("Paste a web link that starts with https://", "job_url", 400);
  if (url.username || url.password) throw new ServiceError("Paste the job link without a username or password in it.", "job_url", 400);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new ServiceError("That link points to a private address.", "job_url", 400);
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new ServiceError("Couldn't reach that website. Check the link and try again.", "job_url", 400);
  if (addresses.some((entry) => privateAddress(entry.address))) throw new ServiceError("That link points to a private address.", "job_url", 400);
  return url;
}

let fetchOverride: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

export function setJobPageFetcherForTests(fetcher: typeof fetchOverride) {
  fetchOverride = fetcher;
}

/** GET a public page with a timeout, a size cap, and checked redirects. */
export async function safeGet(raw: string, accept = "text/html,application/json;q=0.9,*/*;q=0.5", maxBytes = MAX_PAGE_BYTES) {
  if (fetchOverride) {
    const response = await fetchOverride(raw, { headers: { Accept: accept } });
    return { url: raw, status: response.status, ok: response.ok, text: await response.text(), contentType: response.headers.get("content-type") ?? "" };
  }
  let current = await assertPublicUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: accept, "User-Agent": "Mozilla/5.0 (compatible; UnnepoJobReader/1.0; +https://unneponew.vercel.app)" },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      current = await assertPublicUrl(new URL(response.headers.get("location")!, current).toString());
      continue;
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return { url: current.toString(), status: response.status, ok: response.ok, text, contentType: response.headers.get("content-type") ?? "" };
  }
  throw new ServiceError("That link redirects too many times.", "job_url", 400);
}

export async function safeGetJson<T>(raw: string): Promise<T | null> {
  const response = await safeGet(raw, "application/json", MAX_JSON_BYTES);
  if (!response.ok) return null;
  try {
    return JSON.parse(response.text) as T;
  } catch {
    return null;
  }
}
