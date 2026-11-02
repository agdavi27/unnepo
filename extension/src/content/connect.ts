/**
 * Runs on Unnepo's own pages. On /extension/connect, when the student presses Connect, the page posts the new
 * token to itself; this hands it to the extension. On the Applied page, "Fill in from their links" asks the
 * extension to read job board pages in this browser; the answer goes back to the page. Only messages from the
 * page's own window and origin count.
 */
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as { type?: unknown; token?: unknown; requestId?: unknown; jobs?: unknown } | null;
  try {
    if (data?.type === "unnepo:extension-token" && typeof data.token === "string" && data.token.startsWith("unx_")) {
      void chrome.runtime.sendMessage({ type: "connect", token: data.token, origin: window.location.origin }).catch(() => undefined);
    } else if (data?.type === "unnepo:ping") {
      window.postMessage({ type: "unnepo:pong" }, window.location.origin);
    } else if (data?.type === "unnepo:read-links" && Array.isArray(data.jobs)) {
      const requestId = String(data.requestId ?? "");
      void chrome.runtime.sendMessage({ type: "read-links", jobs: data.jobs }).then(
        (answer) => window.postMessage({ type: "unnepo:read-links-done", requestId, results: (answer as { results?: unknown } | undefined)?.results ?? [] }, window.location.origin),
        () => window.postMessage({ type: "unnepo:read-links-done", requestId, results: [], error: "The extension didn't answer." }, window.location.origin),
      );
    }
  } catch {
    // The extension was reloaded since this page opened. The page still shows the code to paste in the panel.
  }
});
