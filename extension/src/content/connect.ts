import { demoMaskForPage } from "../shared/demo-mask";

// Admin demo mode: blur personal info on unnepo.com/home too.
demoMaskForPage();

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
      void chrome.runtime.sendMessage({ type: "connect", token: data.token, origin: window.location.origin })
        .then((answer) => { if ((answer as { ok?: boolean } | undefined)?.ok) window.postMessage({ type: "unnepo:extension-connected" }, window.location.origin); })
        .catch(() => undefined);
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

/**
 * The side panel closes itself on unnepo.com/home (everything it shows is on this page), and tells this page first:
 * a small note at the top says why, and goes away after a few seconds.
 */
let noteTimer = 0;
chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type !== "panel-closed-here") return;
  document.getElementById("unnepo-panel-note")?.remove();
  window.clearTimeout(noteTimer);
  const light = document.documentElement.dataset.theme === "light" || document.querySelector('[data-theme="light"]') !== null;
  const note = document.createElement("div");
  note.id = "unnepo-panel-note";
  note.setAttribute("role", "status");
  note.style.cssText = [
    // Just under the page's header, however tall it is at this width.
    "position:fixed", `top:${Math.max(16, (document.querySelector("header")?.getBoundingClientRect().bottom ?? 0) + 12)}px`, "left:50%", "transform:translateX(-50%)", "z-index:2147483647",
    "display:flex", "align-items:flex-start", "gap:12px", "width:max-content", "max-width:min(420px, calc(100vw - 32px))",
    "padding:12px 12px 12px 16px", "border-radius:12px", "font:14px/1.45 Geist, system-ui, -apple-system, sans-serif",
    `background:${light ? "#FFFFFF" : "#111114"}`, `color:${light ? "#111114" : "#F7F7F8"}`, `border:1px solid ${light ? "#D7D7DE" : "#33333B"}`,
    "box-shadow:0 18px 40px -16px rgba(0,0,0,.55)", "transition:opacity .25s",
  ].join(";");
  const text = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = "The extension panel stays closed here.";
  title.style.cssText = "display:block;font-weight:600";
  const sub = document.createElement("span");
  sub.textContent = "Everything it shows is already on this page. It opens again on any other tab.";
  sub.style.cssText = `display:block;font-size:13px;color:${light ? "#6A6A74" : "#8B8B94"}`;
  text.append(title, sub);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.style.cssText = `flex:none;width:24px;height:24px;border:0;border-radius:6px;background:none;color:inherit;font-size:18px;line-height:1;cursor:pointer;opacity:.6`;
  close.addEventListener("click", () => note.remove());
  note.append(text, close);
  document.body.append(note);
  noteTimer = window.setTimeout(() => {
    note.style.opacity = "0";
    window.setTimeout(() => note.remove(), 300);
  }, 6000);
});
