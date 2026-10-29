import type { PanelState } from "../shared/types";

/** The side panel: connect, fill the job on this tab, see what still needs you, and mark it applied. */

const app = document.getElementById("app")!;
const account = document.getElementById("account")!;

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;

function connectView(state: PanelState) {
  return `
    <h1>Connect your account</h1>
    <p>Unnepo fills applications from your Unnepo profile. Connect once and the extension stays signed in.</p>
    <a class="button primary" href="${escape(state.apiBase)}/extension/connect" target="_blank" rel="noreferrer">Connect on Unnepo</a>
    <div class="card">
      <p class="sub">Or paste the code from the Connect page:</p>
      <input type="text" id="code" placeholder="unx_…" autocomplete="off" spellcheck="false">
      <button id="use-code">Use code</button>
    </div>
    <p class="sub">Your job-site passwords stay on this computer and never go to Unnepo.</p>`;
}

function jobView(state: PanelState) {
  const me = state.me!;
  const tab = state.tab;
  const job = state.job;
  const onWeb = tab && /^https:\/\//.test(tab.url);
  const report = job?.report;
  const parts: string[] = [];
  parts.push(`
    <div class="card">
      <div class="row"><span class="title">Your profile</span><span class="mono">${me.completeness}% ready</span></div>
      <div class="bar"><div style="width:${me.completeness}%"></div></div>
      ${me.profileReady ? "" : `<p class="warn">Finish your profile on Unnepo first so there's something to fill with.</p>`}
      <p class="sub">${me.credits} credit${me.credits === 1 ? "" : "s"} left</p>
    </div>`);
  if (!onWeb) {
    parts.push(`<p>Open a job application in this tab, then come back here and press Fill.</p>`);
  } else {
    parts.push(`
      <div class="card">
        <span class="title">${escape(job?.title || tab!.title || "This page")}</span>
        ${job?.company ? `<span class="sub">${escape(job.company)}</span>` : ""}
        ${job?.step ? `<p>${escape(job.step)}</p>` : `<p class="sub">Unnepo reads the form, prepares every answer from your profile, and fills it. You press Submit.</p>`}
        ${job?.error ? `<p class="error">${escape(job.error)}</p>` : ""}
        ${report?.needsYou.length ? `<p class="warn">Still needs you:</p><ul>${report.needsYou.map((label) => `<li>${escape(label)}</li>`).join("")}</ul>` : ""}
        ${report?.failed.length ? `<p class="sub">Couldn't fill: ${report.failed.map((item) => escape(item.label)).join("; ")}</p>` : ""}
        ${job?.submission ? `<p class="ok">${job.submission === "confirmed" ? "Submission confirmed by the site." : "Looks submitted."} Saved to your tracker.</p>` : ""}
        <div class="actions">
          <button class="primary" id="fill" ${me.profileReady ? "" : "disabled"}>${report ? "Fill again" : "Fill this application"}</button>
          ${job?.applicationId && !job.submission ? `<button id="applied">I applied</button>` : ""}
          ${job?.submission ? `<button id="not-applied">I didn't apply</button>` : ""}
        </div>
      </div>`);
  }
  parts.push(`
    <label class="toggle"><input type="checkbox" id="pause" ${state.autoSubmit ? "" : "checked"}> <span>Pause before each submit, so you can check the form and press Submit yourself.</span></label>
    <button id="disconnect">Sign out of the extension</button>`);
  return parts.join("");
}

async function render() {
  const state = await ask<PanelState>({ type: "state" });
  account.textContent = state.connected ? state.me!.user.email : "";
  app.innerHTML = state.connected ? jobView(state) : connectView(state);
  document.getElementById("use-code")?.addEventListener("click", async () => {
    const code = (document.getElementById("code") as HTMLInputElement).value.trim();
    if (code.startsWith("unx_")) await ask({ type: "connect", token: code });
    void render();
  });
  document.getElementById("fill")?.addEventListener("click", () => void ask({ type: "fill", tabId: state.tab!.id }));
  document.getElementById("applied")?.addEventListener("click", () => void ask({ type: "applied", tabId: state.tab!.id }));
  document.getElementById("not-applied")?.addEventListener("click", () => void ask({ type: "not-applied", tabId: state.tab!.id }));
  document.getElementById("pause")?.addEventListener("change", (event) => void ask({ type: "set-auto-submit", value: !(event.target as HTMLInputElement).checked }));
  document.getElementById("disconnect")?.addEventListener("click", async () => {
    await ask({ type: "disconnect" });
    void render();
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "state-changed") void render();
});
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") void render();
});
void render();
