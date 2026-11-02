"use client";

/**
 * Talking to the Unnepo extension from Unnepo's own pages, through its page script (extension/src/content/connect.ts).
 * Job boards only show their jobs in the student's browser, so the extension reads those links there.
 */

const origin = () => window.location.origin;

/** Whether the extension is installed and answering on this page. */
export function extensionHere(timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(found: boolean) {
      clearTimeout(timer);
      window.removeEventListener("message", listen);
      resolve(found);
    }
    function listen(event: MessageEvent) {
      if (event.source === window && event.origin === origin() && (event.data as { type?: string } | null)?.type === "unnepo:pong") finish(true);
    }
    window.addEventListener("message", listen);
    window.postMessage({ type: "unnepo:ping" }, origin());
  });
}

export type ReadResult = { id: string; ok: boolean; error?: string; changed?: string[]; info?: { title: string; company: string; location: string; description: string; url: string } };

/**
 * Asks the extension to read each link: a saved job (with its id) is filled in, a link without one (the add
 * form) comes back with what the page showed. One at a time; a few seconds each.
 */
export function readLinksInBrowser(jobs: Array<{ id: string; url: string }>, timeoutMs = 40_000 * Math.max(1, jobs.length)): Promise<ReadResult[]> {
  const requestId = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish([]), timeoutMs);
    function finish(results: ReadResult[]) {
      clearTimeout(timer);
      window.removeEventListener("message", listen);
      resolve(results);
    }
    function listen(event: MessageEvent) {
      const data = event.data as { type?: string; requestId?: string; results?: ReadResult[] } | null;
      if (event.source === window && event.origin === origin() && data?.type === "unnepo:read-links-done" && data.requestId === requestId) finish(data.results ?? []);
    }
    window.addEventListener("message", listen);
    window.postMessage({ type: "unnepo:read-links", requestId, jobs }, origin());
  });
}
