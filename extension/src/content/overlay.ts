import { demoMaskForPage } from "../shared/demo-mask";
import { H, W, spiderRects, storedSpiderColors } from "../shared/sprite";
import type { TrackerContact, TrackerJob } from "../shared/types";
import { companyGuess } from "@/lib/apply/company-name";

// Admin demo mode: blur personal info on this page and in Unnepo's cards on it.
demoMaskForPage();

/**
 * Unnepo on the page, like Grammarly: a card in the bottom-right of a job page, in its own shadow root so the
 * site's CSS can't touch it. The background worker puts this script on the page and tells it when an application
 * was caught here. The card has two steps:
 *   1. "Did you apply?", every time (even when Unnepo already saved it). Yes asks "Is this right?" with the title
 *      and company to fix (the company blank when the page only showed a job site's name or a line like "No response
 *      insights available yet"); No takes a saved job back out. Then it's Saved, with Undo.
 *   Between them, once it's saved, on every plan: "Reach out to <company>?", with how many companies are left
 *      (Free: today, Pro: this month). Yes finds the people, which uses one of them; No leaves it.
 *   2. Reach out: up to two people at the company, each with Auto write email (written from the resume and opened
 *      in Gmail ready to send; the draft never shows here) and Manual write email (an empty email to them). Once one
 *      opens, "Sent?" asks; the buttons stay, so the student can still write it the other way.
 * Nothing on the page is read, and nothing is sent until a button is pressed. Later shrinks it to a small tab.
 */

type Free = { free: boolean; peopleLeft: number | null; peopleCount?: { left: number; of: number; per: "today" | "this month" } | null };
type CardState = { ok: boolean; item: { id: string; title: string; company: string; state: string; sure: string } | null; applicationId: string; job: TrackerJob | null; opened: string[] } & Free;

declare global { interface Window { __unnepoOverlay?: boolean } }

if (!window.__unnepoOverlay) {
  window.__unnepoOverlay = true;
  start();
}

function start() {
  const ask = <T>(message: unknown) => chrome.runtime.sendMessage(message) as Promise<T>;
  const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CLOSED = "unnepoCardsClosed";
  const closedIds = () => { try { return JSON.parse(sessionStorage.getItem(CLOSED) || "[]") as string[]; } catch { return []; } };
  const close = (key: string) => { try { sessionStorage.setItem(CLOSED, JSON.stringify([...closedIds(), key].slice(-20))); } catch { /* storage off: closed for now */ } };

  const host = document.createElement("div");
  host.setAttribute("data-unnepo-card", "");
  const root = host.attachShadow({ mode: "closed" });
  let spider = spiderRects(0);
  void storedSpiderColors().then((colors) => { spider = spiderRects(0, colors); draw(); });

  /** What the card shows. `id`: the Detected jobs entry; `applicationId` once it's saved. */
  const card = {
    id: "", applicationId: "", data: null as CardState | null, small: false, busy: new Set<string>(), note: "",
    /** People whose email was just opened, waiting on "Sent?". */
    opened: new Set<string>(), sent: new Set<string>(), poll: 0,
    /** Slid in already: redraws don't play it again. */
    shown: false,
    /** Said yes to reaching out: past the question to the people. */
    passed: false,
    /** Said no to reaching out. */
    declined: false,
    /** After "Yes, I applied": the title and company to check before it's saved. */
    check: null as { title: string; company: string } | null,
    /** The student said they applied and the title and company are right. */
    confirmed: false,
  };

  const AV = ["#3D8BFF", "#8B5CF6", "#EC4899", "#14B8A6", "#F59E0B", "#22C55E", "#EF4444", "#06B6D4"];
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
  const color = (name: string) => AV[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AV.length];

  const STYLE = `
    :host { all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111114; }
    * { box-sizing: border-box; }
    .card { width: 320px; max-height: calc(100vh - 40px); overflow: auto; background: #fff; border: 1px solid #E4E4EA; border-radius: 16px; box-shadow: 0 12px 32px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.08); }
    .card.enter { animation: ${reduce ? "none" : "in .28s cubic-bezier(.2,1.2,.4,1) both"}; }
    @keyframes in { from { transform: translateY(16px); opacity: 0; } to { transform: none; opacity: 1; } }
    .head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px 14px; }
    .head svg { width: 22px; height: ${Math.round((22 * H) / W)}px; flex: none; }
    .brand { font-weight: 700; font-size: 14px; letter-spacing: -.01em; flex: 1; }
    .brand span { color: #3D8BFF; }
    .icon { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: #6A6A74; font-size: 16px; }
    .icon:hover { background: #F2F2F6; color: #111114; }
    .icon:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid #3D8BFF; outline-offset: 2px; }
    .step { display: flex; gap: 10px; padding: 10px 14px; border-top: 1px solid #EFEFF3; }
    .num { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font: 600 11px system-ui, sans-serif; background: #EFEFF3; color: #45454E; }
    .num.done { background: #DCFCE7; color: #15803D; }
    .num.now { background: #3D8BFF; color: #fff; }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .label { font: 600 11px system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #6A6A74; }
    .job { font-weight: 600; }
    .sub { font-size: 12px; color: #5C5C66; }
    .row { display: flex; align-items: center; gap: 8px; }
    .person { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
    .person-block { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 8px; }
    .person-block + .person-block { border-top: 1px solid #EFEFF3; padding-top: 8px; }
    .av { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: #fff; font: 600 10px system-ui, sans-serif; }
    .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .who b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who span { font-size: 11.5px; color: #5C5C66; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btn { all: unset; cursor: pointer; height: 30px; padding: 0 11px; border-radius: 9px; font: 600 12px system-ui, sans-serif; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; background: #3D8BFF; color: #fff; }
    .btn:hover { background: #2F6FEB; }
    .btn.ghost { background: transparent; color: #111114; box-shadow: inset 0 0 0 1px #D7D7DE; font-weight: 500; }
    .btn.ghost:hover { background: #F5F5F7; }
    .btn.ok { background: #16A34A; } .btn.ok:hover { background: #15803D; }
    .btn[disabled] { cursor: default; opacity: .6; }
    .btn.wide { flex: 1; justify-content: center; }
    .quiet { all: unset; cursor: pointer; font-size: 12px; color: #5C5C66; text-decoration: underline; text-underline-offset: 3px; }
    .done { font-size: 12px; color: #15803D; font-weight: 600; }
    .note { font-size: 12px; color: #B45309; }
    .bar { height: 4px; border-radius: 2px; background: #EFEFF3; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 40%; background: #3D8BFF; border-radius: 2px; animation: ${reduce ? "none" : "slide 1.2s ease-in-out infinite"}; }
    @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
    .count { display: flex; align-items: baseline; gap: 6px; }
    .count b { font: 700 28px/1 system-ui, sans-serif; letter-spacing: -.02em; }
    .count b.out { color: #B45309; }
    .count span { font-size: 12px; color: #5C5C66; }
    .meter { height: 6px; border-radius: 3px; background: #EFEFF3; overflow: hidden; }
    .meter i { display: block; height: 100%; background: #3D8BFF; border-radius: 3px; }
    .meter.low i { background: #F59E0B; }
    .field { display: flex; flex-direction: column; gap: 3px; }
    .field span { font-size: 11px; color: #5C5C66; font-weight: 600; }
    .field input { all: unset; box-sizing: border-box; height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid #D7D7DE; background: #fff; color: #111114; font: 13px system-ui, sans-serif; }
    .field input:focus { border-color: #3D8BFF; box-shadow: 0 0 0 2px rgba(61,139,255,.2); }
    .field input.empty { border-color: #F59E0B; }
    .foot { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px 12px; border-top: 1px solid #EFEFF3; }
    .pill { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 12px 8px 10px; background: #fff; border: 1px solid #E4E4EA; border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.14); font-weight: 600; }
    .pill svg { width: 20px; height: ${Math.round((20 * H) / W)}px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #3D8BFF; }
  `;

  const spiderSvg = () => `<svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true"><g transform="rotate(180 ${W / 2} ${H / 2})">${spider}</g></svg>`;

  /** Step 1: the job is logged, or Unnepo asks. */
  function stepOne(data: CardState) {
    const item = data.item;
    const job = data.job;
    const title = job?.title || item?.title || "This job";
    const company = companyGuess(job?.company || item?.company || "") || job?.company || "";
    const saved = card.confirmed;
    const asking = !saved;
    if (asking && card.check) {
      const busy = card.busy.has("answer");
      return `
      <div class="step">
        <span class="num now" aria-hidden="true">1</span>
        <div class="body">
          <span class="label">Is this right?</span>
          <label class="field"><span>Job title</span><input data-check="title" value="${escape(card.check.title)}" placeholder="Job title" class="${card.check.title.trim() ? "" : "empty"}"></label>
          <label class="field"><span>Company</span><input data-check="company" value="${escape(card.check.company)}" placeholder="Which company?" class="${card.check.company.trim() ? "" : "empty"}"></label>
          <div class="row"><button type="button" class="btn" data-act="save" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Looks right, save it"}</button><button type="button" class="btn ghost" data-act="back" ${busy ? "disabled" : ""}>Back</button></div>
        </div>
      </div>`;
    }
    return `
      <div class="step">
        <span class="num ${saved ? "done" : "now"}" aria-hidden="true">${saved ? "✓" : "1"}</span>
        <div class="body">
          <span class="label">${saved ? "Saved to your jobs" : "Did you apply?"}</span>
          <span class="job">${escape(title)}</span>
          ${company ? `<span class="sub">${escape(company)}</span>` : ""}
          ${asking ? `<div class="row"><button type="button" class="btn" data-act="yes" ${card.busy.has("answer") ? "disabled" : ""}>${card.busy.has("answer") ? "Saving…" : "Yes, I applied"}</button><button type="button" class="btn ghost" data-act="no">No</button></div>`
            : saved ? `<button type="button" class="quiet" data-act="undo" style="width: fit-content">Not applied? Undo</button>` : ""}
        </div>
      </div>`;
  }

  /** Free sees the one person it unlocked (the posting's first); Pro, the first two. */
  function people(data: CardState) {
    const list = data.job?.contacts ?? [];
    if (!data.free) return list.slice(0, 2);
    const pick = list.find((person) => person.role === "job_poster") ?? list.find((person) => person.email) ?? list[0];
    return pick ? [pick] : [];
  }

  /**
   * One person: Auto write email and Manual write email always show (so the student can change their mind), with
   * "Sent?" under them once an email opened, or Emailed ✓ once it went.
   */
  function personRow(person: TrackerContact) {
    const auto = card.busy.has(`email:${person.id}`);
    const manual = card.busy.has(`manual:${person.id}`);
    const emailed = card.sent.has(person.id) || person.outreachStatus !== "not_contacted";
    const id = escape(person.id);
    const buttons = person.email
      ? `<div class="row"><button type="button" class="btn wide" data-act="email" data-id="${id}" ${auto ? "disabled" : ""}>${auto ? "Writing…" : "Auto write email"}</button><button type="button" class="btn ghost wide" data-act="manual" data-id="${id}" ${manual ? "disabled" : ""}>Manual write email</button></div>`
      : `<span class="sub">No email for them.</span>`;
    const status = card.opened.has(person.id)
      ? `<div class="row"><span class="sub" style="flex:1">Sent it?</span><button type="button" class="btn ok" data-act="sent" data-id="${id}">Sent</button><button type="button" class="btn ghost" data-act="notyet" data-id="${id}">Not yet</button></div>`
      : emailed ? `<span class="done">Emailed ✓</span>` : "";
    return `<div class="person-block"><div class="person"><span class="av" style="background:${color(person.name)}">${escape(initials(person.name))}</span><span class="who"><b>${escape(person.name)}</b><span>${escape(person.title || "")}</span></span></div>${buttons}${status}</div>`;
  }

  /**
   * Once the job is saved, on every plan: "Reach out to <company>?", with how many companies are left (Free: today,
   * Pro: this month). Yes finds the people (one company used); No leaves it, with a way back.
   */
  function gate(data: CardState, job: TrackerJob, count: CardState["peopleCount"]) {
    const company = job.company || data.item?.company || "the company";
    const short = escape(company.length > 22 ? `${company.slice(0, 21)}…` : company);
    const left = count ? Math.max(0, Math.min(count.left, count.of)) : null;
    const out = left === 0;
    const meter = count && left !== null
      ? `<div class="count" aria-label="${left} of ${count.of} companies left ${count.per}"><b class="${out ? "out" : ""}">${left}</b><span>of ${count.of} companies left ${count.per}</span></div>
          <div class="meter${left / count.of <= 0.2 ? " low" : ""}" aria-hidden="true"><i style="width:${Math.round((left / count.of) * 100)}%"></i></div>`
      : "";
    // Found already (on the website, say): Yes just shows them, nothing more is used.
    const found = people(data).length > 0;
    const action = card.declined
      ? `<span class="sub">Okay, not reaching out to ${escape(company)}.</span><button type="button" class="quiet" data-act="undecline" style="width: fit-content">Changed your mind?</button>`
      : out && !found
        ? `<span class="sub">${data.free ? "None left today. More tomorrow, or Pro finds people at 100 companies a month." : "None left this month. More next month."}</span><div class="row"><button type="button" class="btn ghost wide" data-act="linkedin">Find on LinkedIn instead</button><button type="button" class="btn ghost" data-act="decline">No</button></div>`
        : `<div class="row"><button type="button" class="btn wide" data-act="reach">Yes, reach out</button><button type="button" class="btn ghost wide" data-act="decline">No</button></div>`;
    return `
      <div class="step">
        <span class="num now" aria-hidden="true">2</span>
        <div class="body">
          <span class="label">Reach out to ${short}?</span>
          ${meter}
          <span class="sub">${found ? `Unnepo already found people at ${escape(company)}.` : `Yes finds a recruiter or someone on the team at ${escape(company)}, with a work email, and uses one company.`}</span>
          ${action}
        </div>
      </div>`;
  }

  /** Step 2: who to email, or finding them. */
  function stepTwo(data: CardState) {
    const job = data.job;
    const saved = Boolean(card.applicationId) && card.confirmed;
    if (saved && job && !card.passed) return gate(data, job, data.peopleCount);
    const company = job?.company || card.check?.company.trim() || companyGuess(data.item?.company || "") || "the company";
    let inner = `<span class="sub">Once it's saved, Unnepo finds who to email at ${escape(company)}.</span>`;
    if (saved && job) {
      const shown = people(data);
      const finding = job.contactsStatus === "finding" || job.contactsStatus === "writing" || card.busy.has("find");
      if (shown.length) {
        inner = `${shown.map(personRow).join("")}<span class="sub">Auto writes it from your resume and opens Gmail, ready to send. Manual opens an empty email to them.</span>`;
      } else if (finding) {
        inner = `<span class="sub">${escape(job.contactsMessage || `Finding people at ${company}…`)}</span><div class="bar" role="progressbar" aria-label="Finding people"><i></i></div>`;
      } else {
        const left = data.peopleLeft ?? 0;
        const verified = data.free ? (left ? `Find verified · ${left} left` : "Verified · Pro") : "Find verified";
        inner = `<span class="sub">${job.contactsStatus === "done" || job.contactsStatus === "failed" ? `No one found at ${escape(company)} yet.` : `Find a recruiter or someone on the team at ${escape(company)}.`}</span>
          <div class="row"><button type="button" class="btn ghost wide" data-act="linkedin">Find on LinkedIn</button><button type="button" class="btn wide" data-act="find" ${data.free && !left ? "disabled" : ""}>${verified}</button></div>`;
      }
    }
    return `
      <div class="step">
        <span class="num ${saved ? "now" : ""}" aria-hidden="true">2</span>
        <div class="body"><span class="label">Reach out</span>${inner}</div>
      </div>`;
  }

  function draw() {
    if (!card.data) return;
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (card.small) {
      root.innerHTML = `<style>${STYLE}</style><button type="button" class="pill" data-act="open" aria-label="Open the Unnepo card">${spiderSvg()}<span>Reach out</span><span class="dot" aria-hidden="true"></span></button>`;
      return;
    }
    root.innerHTML = `<style>${STYLE}</style>
      <section class="card${card.shown ? "" : " enter"}" role="dialog" aria-label="Unnepo: you applied">
        <div class="head">${spiderSvg()}<span class="brand">unnepo<span>.</span></span>
          <button type="button" class="icon" data-act="later" aria-label="Shrink" title="Later">–</button>
          <button type="button" class="icon" data-act="close" aria-label="Close" title="Close">×</button>
        </div>
        ${stepOne(card.data)}
        ${stepTwo(card.data)}
        ${card.note ? `<div class="step"><span class="note" role="status">${escape(card.note)}</span></div>` : ""}
        <div class="foot"><button type="button" class="quiet" data-act="off">Don't show these cards</button>${card.sent.size ? `<button type="button" class="btn ghost" data-act="close">Done</button>` : `<button type="button" class="btn ghost" data-act="later">Later</button>`}</div>
      </section>`;
    card.shown = true;
  }

  async function load(fresh = false) {
    const data = await ask<CardState>({ type: "card-state", id: card.id, applicationId: card.applicationId, fresh }).catch(() => null);
    if (!data?.ok) return;
    if (data.applicationId) card.applicationId = data.applicationId;
    for (const id of data.opened) card.opened.add(id);
    card.data = data;
    draw();
    // While people are being found, look again every few seconds.
    clearTimeout(card.poll);
    const finding = data.job && (data.job.contactsStatus === "finding" || data.job.contactsStatus === "writing");
    if (finding) card.poll = window.setTimeout(() => void load(), 3000);
  }

  const busy = async (key: string, work: () => Promise<void>) => {
    card.busy.add(key);
    card.note = "";
    draw();
    try { await work(); } finally { card.busy.delete(key); draw(); }
  };

  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!button || (button as HTMLButtonElement).disabled) return;
    const id = button.dataset.id ?? "";
    switch (button.dataset.act) {
      case "open": card.small = false; return draw();
      case "later": card.small = true; return draw();
      case "close":
        close(card.applicationId || card.id);
        host.remove();
        return;
      case "off":
        void ask({ type: "card-off" });
        host.remove();
        return;
      case "yes": {
        const item = card.data?.item;
        const job = card.data?.job;
        card.check = { title: (job?.titleMissing ? "" : job?.title || item?.title || "").trim(), company: companyGuess(job?.companyMissing ? "" : job?.company || item?.company || "") };
        card.note = "";
        draw();
        const first = root.querySelector<HTMLInputElement>(card.check.company ? '[data-check="title"]' : '[data-check="company"]');
        if (!card.check.company) first?.focus();
        return;
      }
      case "back":
        card.check = null;
        card.note = "";
        return draw();
      case "save": {
        const check = card.check;
        if (!check) return;
        if (!check.title.trim() || !check.company.trim()) {
          card.note = !check.company.trim() ? "Add the company." : "Add the job title.";
          draw();
          root.querySelector<HTMLInputElement>(`[data-check="${!check.company.trim() ? "company" : "title"}"]`)?.focus();
          return;
        }
        return void busy("answer", async () => {
          type Answered = { ok: boolean; applicationId?: string; error?: string };
          const fields = { title: check.title.trim(), company: check.company.trim() };
          // Saved already (Unnepo caught it): only the title and company are fixed. Otherwise it's saved now.
          const result = card.applicationId
            ? await ask<Answered>({ type: "card-confirm", id: card.id, applicationId: card.applicationId, ...fields }).catch((): Answered => ({ ok: false, error: "Couldn't reach Unnepo." }))
            : await ask<Answered>({ type: "card-answer", id: card.id, applied: true, checked: true, ...fields }).catch((): Answered => ({ ok: false, error: "Couldn't reach Unnepo." }));
          if (result.ok && (result.applicationId || card.applicationId)) { card.applicationId = result.applicationId || card.applicationId; card.check = null; card.confirmed = true; await load(true); }
          else card.note = result.error ?? "Couldn't save it.";
        });
      }
      case "no":
        // Saved by itself already: No takes it back out of the student's jobs.
        if (card.applicationId) {
          return void busy("undo", async () => {
            const result = await ask<{ ok: boolean; error?: string }>({ type: "card-undo", id: card.id, applicationId: card.applicationId }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
            if (result.ok) { close(card.applicationId || card.id); host.remove(); }
            else card.note = result.error ?? "Couldn't take it out.";
          });
        }
        void ask({ type: "card-answer", id: card.id, applied: false });
        close(card.id);
        host.remove();
        return;
      case "undo":
        return void busy("undo", async () => {
          const result = await ask<{ ok: boolean; error?: string }>({ type: "card-undo", id: card.id, applicationId: card.applicationId }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
          if (result.ok) { close(card.applicationId || card.id); host.remove(); }
          else card.note = result.error ?? "Couldn't undo it.";
        });
      case "decline":
        card.declined = true;
        return draw();
      case "undecline":
        card.declined = false;
        return draw();
      case "reach":
        card.passed = true;
        // People already found: they show, and nothing more is used.
        if (card.data && people(card.data).length) return draw();
        return void busy("find", async () => {
          const result = await ask<{ ok: boolean; error?: string }>({ type: "card-people", body: { action: "find", applicationId: card.applicationId } }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
          if (!result.ok) card.note = result.error ?? "Couldn't start the search.";
          await load(true);
        });
      case "find":
        card.passed = true;
        return void busy("find", async () => {
          const result = await ask<{ ok: boolean; error?: string }>({ type: "card-people", body: { action: "find", applicationId: card.applicationId } }).catch(() => ({ ok: false, error: "Couldn't reach Unnepo." }));
          if (!result.ok) card.note = result.error ?? "Couldn't start the search.";
          await load(true);
        });
      case "linkedin":
        void ask<{ ok: boolean; error?: string }>({ type: "card-linkedin", applicationId: card.applicationId }).then((result) => {
          if (!result?.ok) { card.note = result?.error ?? "Click the Unnepo icon in your toolbar."; draw(); }
        });
        return;
      case "email":
        return void busy(`email:${id}`, async () => {
          type Wrote = { ok: boolean; error?: string; mailto?: string; cut?: boolean; body?: string };
          const result = await ask<Wrote>({ type: "card-email", applicationId: card.applicationId, contactId: id }).catch((): Wrote => ({ ok: false, error: "Couldn't reach Unnepo." }));
          if (!result.ok) { card.note = result.error ?? "Couldn't write the email."; return; }
          card.opened.add(id);
          if (result.cut && result.body) {
            await navigator.clipboard.writeText(result.body).catch(() => undefined);
            card.note = "The email was long, so it's copied: paste it into the email that opened.";
          }
          if (result.mailto) window.location.href = result.mailto;
        });
      case "manual":
        return void busy(`manual:${id}`, async () => {
          type Opened = { ok: boolean; error?: string; mailto?: string };
          const result = await ask<Opened>({ type: "card-email", applicationId: card.applicationId, contactId: id, manual: true }).catch((): Opened => ({ ok: false, error: "Couldn't reach Unnepo." }));
          if (!result.ok) { card.note = result.error ?? "Couldn't open the email."; return; }
          card.opened.add(id);
          if (result.mailto) window.location.href = result.mailto;
        });
      case "sent":
        card.opened.delete(id);
        card.sent.add(id);
        draw();
        void ask({ type: "card-people", body: { action: "status", applicationId: card.applicationId, contactId: id, status: "emailed" } }).then(() => load());
        return;
      case "notyet":
        card.opened.delete(id);
        draw();
        return;
    }
  });

  // Typing in "Is this right?" keeps what's typed without redrawing (so the cursor stays put); Enter saves.
  root.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset?.check as "title" | "company" | undefined;
    if (!key || !card.check) return;
    card.check[key] = input.value;
    input.classList.toggle("empty", !input.value.trim());
  });
  root.addEventListener("keydown", (event) => {
    const input = event.target as HTMLElement;
    if ((event as KeyboardEvent).key === "Enter" && input.dataset?.check) { event.preventDefault(); root.querySelector<HTMLButtonElement>('[data-act="save"]')?.click(); }
    // Typing here belongs to the card, not the job page's own shortcuts.
    if (input.dataset?.check) event.stopPropagation();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "applied-card") return;
    const key = String(message.applicationId || message.id);
    if (closedIds().includes(key)) return;
    // A new application on the same page (a job board's next job) takes the card over.
    if (card.id !== message.id) Object.assign(card, { small: false, note: "", data: null, shown: false, passed: false, declined: false, check: null, confirmed: false });
    card.id = String(message.id);
    card.applicationId = String(message.applicationId || "");
    void load(true);
  });
}
