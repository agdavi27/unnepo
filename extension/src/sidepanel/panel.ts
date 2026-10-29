import { PASSWORD_RULES, unmetRules } from "../shared/password";
import type { PanelState } from "../shared/types";

/** The side panel: connect, fill the job on this tab, see what still needs you, and mark it applied. */

const app = document.getElementById("app")!;
const account = document.getElementById("account")!;
const passwordSection = document.getElementById("password")!;

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
        ${job?.step ? `<p>${job.running ? `<span class="live" aria-hidden="true"></span>` : ""}${escape(job.step)}</p>` : `<p class="sub">Works from the job posting: Unnepo presses Apply, makes your account or signs in, fills every page, and keeps going until you press Stop.</p>`}
        ${job?.error ? `<p class="error">${escape(job.error)}</p>` : ""}
        ${report?.needsYou.length ? `<p class="warn">Still needs you:</p><ul>${report.needsYou.map((label) => `<li>${escape(label)}</li>`).join("")}</ul>` : ""}
        ${report?.failed.length ? `<p class="sub">Couldn't fill: ${report.failed.map((item) => escape(item.label)).join("; ")}</p>` : ""}
        ${job?.submission ? `<p class="ok">${job.submission === "confirmed" ? "Submission confirmed by the site." : "Looks submitted."} Saved to your tracker.</p>` : ""}
        <div class="actions">
          ${job?.running
            ? `<button class="stop" id="stop">Stop</button>`
            : `<button class="primary" id="fill" ${me.profileReady ? "" : "disabled"}>${report ? "Fill again" : "Fill this application"}</button>`}
          ${job?.applicationId && !job.submission && !job.running ? `<button id="applied">I applied</button>` : ""}
          ${job?.cv ? `<button id="generate-cv">Generate CV</button>` : ""}
          ${job?.submission ? `<button id="not-applied">I didn't apply</button>` : ""}
        </div>
      </div>`);
  }
  parts.push(`
    <label class="toggle"><input type="checkbox" id="pause" ${state.autoSubmit ? "" : "checked"}> <span>Let me press Submit myself. Turn this off and Unnepo presses Submit too, once every field is filled.</span></label>
    <button id="disconnect">Sign out of the extension</button>`);
  return parts.join("");
}

/**
 * The job-site password card. It's drawn on its own, not with the rest of the panel, so a password being
 * typed isn't wiped when the panel refreshes.
 */
let passwordMode: "hidden" | "shown" | "editing" = "hidden";
let passwordNote = "";

async function renderPassword() {
  const { password } = await ask<{ password?: string }>({ type: "get-password" });
  if (!password) return;
  const rules = (value: string) => PASSWORD_RULES.map((rule) => `<li class="${rule.test(value) ? "met" : ""}">${escape(rule.label)}</li>`).join("");
  passwordSection.innerHTML = `
    <h2>Job-site password</h2>
    <p class="sub">Unnepo types this when a job site asks you to create an account or sign in. It stays on this computer and never goes to Unnepo.</p>
    ${passwordMode === "editing" ? `
      <input type="text" id="new-password" autocomplete="off" spellcheck="false" placeholder="Your new password">
      <ul class="rules" id="rules">${rules("")}</ul>
      <p class="sub">Accounts you already made keep their old password.</p>
      <div class="actions small"><button class="primary" id="save-password" disabled>Save password</button><button id="cancel-password">Cancel</button></div>
    ` : `
      <div class="secret">${passwordMode === "shown" ? escape(password) : "•".repeat(Math.min(password.length, 16))}</div>
      <div class="actions small">
        <button id="toggle-password">${passwordMode === "shown" ? "Hide" : "Show"}</button>
        <button id="copy-password">Copy</button>
        <button id="change-password">Change</button>
        <button id="regenerate-password">Make a new one</button>
      </div>
    `}
    ${passwordNote ? `<p class="sub">${escape(passwordNote)}</p>` : ""}`;
  const redraw = (mode: typeof passwordMode, note = "") => { passwordMode = mode; passwordNote = note; void renderPassword(); };
  document.getElementById("toggle-password")?.addEventListener("click", () => redraw(passwordMode === "shown" ? "hidden" : "shown"));
  document.getElementById("copy-password")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(password).then(() => redraw(passwordMode, "Copied."), () => redraw(passwordMode, "Couldn't copy. Press Show and copy it yourself."));
  });
  document.getElementById("change-password")?.addEventListener("click", () => redraw("editing"));
  document.getElementById("cancel-password")?.addEventListener("click", () => redraw("hidden"));
  document.getElementById("regenerate-password")?.addEventListener("click", async () => {
    if (!confirm("Make a new password? Accounts you already made keep the old one, so keep a copy if you'll sign in to them again.")) return;
    await ask({ type: "new-password" });
    redraw("shown", "New password made.");
  });
  const input = document.getElementById("new-password") as HTMLInputElement | null;
  const save = document.getElementById("save-password") as HTMLButtonElement | null;
  input?.focus();
  input?.addEventListener("input", () => {
    document.getElementById("rules")!.innerHTML = rules(input.value);
    save!.disabled = unmetRules(input.value).length > 0;
  });
  save?.addEventListener("click", async () => {
    const result = await ask<{ ok: boolean; unmet?: string[] }>({ type: "set-password", value: input!.value });
    if (result.ok) redraw("hidden", "Password saved.");
    else passwordNote = `Still needs: ${(result.unmet ?? []).join(", ").toLowerCase()}.`;
  });
}

async function render() {
  const state = await ask<PanelState>({ type: "state" });
  account.textContent = state.connected ? state.me!.user.email : "";
  const wasHidden = passwordSection.hidden;
  passwordSection.hidden = !state.connected;
  if (state.connected && wasHidden) void renderPassword();
  app.innerHTML = state.connected ? jobView(state) : connectView(state);
  document.getElementById("use-code")?.addEventListener("click", async () => {
    const code = (document.getElementById("code") as HTMLInputElement).value.trim();
    if (code.startsWith("unx_")) await ask({ type: "connect", token: code });
    void render();
  });
  document.getElementById("fill")?.addEventListener("click", () => void ask({ type: "fill", tabId: state.tab!.id }));
  // Not connected to anything yet: CV generation is on its way.
  document.getElementById("generate-cv")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "CV generation is coming soon";
  });
  document.getElementById("stop")?.addEventListener("click", () => void ask({ type: "stop", tabId: state.tab!.id }));
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
