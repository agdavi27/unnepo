/**
 * Runs on Unnepo's /extension/connect page. When the student presses Connect, the page posts the new
 * token to itself; this hands it to the extension. Only messages from the page's own window and origin count.
 */
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as { type?: unknown; token?: unknown } | null;
  if (data?.type !== "unnepo:extension-token" || typeof data.token !== "string" || !data.token.startsWith("unx_")) return;
  void chrome.runtime.sendMessage({ type: "connect", token: data.token, origin: window.location.origin });
});
