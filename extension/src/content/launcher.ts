import { H, spiderRects, W } from "../shared/sprite";
import { watchEdits } from "./edits";

/**
 * The little spider that drops down on the right of a job page, like a "fill with" button. It runs on
 * job systems and on pages whose address mentions jobs, careers, or applying, and only shows once the
 * page looks like a job posting or an application. Clicking it opens the Unnepo side panel. It sends
 * nothing anywhere and reads nothing but whether the page looks like a job page, which questions the
 * student answered by hand (marked on the page only, so Fill leaves them alone), and whether the page says
 * the application went through (told to the extension, for the dancing spiders).
 */

const ATS_HOST = /(myworkdayjobs|myworkdaysite|greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|icims|jobvite|bamboohr|paycomonline|paylocity|ultipro|ukg|taleo|successfactors|breezy\.hr|recruitee|teamtailor|rippling|applytojob|dayforcehcm|oraclecloud|eightfold|avature|phenom|gem\.com|dover\.com|wellfound)\./i;
const APPLY = /^(apply( now| for this (job|position|role|opportunity)| here| online| today)?|i(?:'|’)?m interested|start (my |your )?application|easy apply)$/i;
const DISMISSED = "unnepo-launcher-dismissed";

function looksLikeJobPage() {
  if (ATS_HOST.test(location.hostname)) return true;
  const buttons = Array.from(document.querySelectorAll<HTMLElement>("a, button, [role=button], input[type=submit]"));
  if (buttons.some((el) => APPLY.test((el.textContent || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim()))) return true;
  // An application form: an upload box, or several fields alongside job words.
  const fields = document.querySelectorAll("input:not([type=hidden]):not([type=search]), textarea, select").length;
  if (document.querySelector("input[type=file]") && fields >= 3) return true;
  return fields >= 6 && /\b(resume|cv|cover letter|work authori[sz]ation|years of experience)\b/i.test(document.body.innerText || "");
}

function show() {
  if (document.querySelector("[data-unnepo-launcher]")) return;
  const host = document.createElement("div");
  host.setAttribute("data-unnepo-launcher", "");
  const root = host.attachShadow({ mode: "closed" });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; top: 0; right: 22px; z-index: 2147483646; font: 13px/1.3 system-ui, -apple-system, sans-serif; }
      .wrap { position: relative; display: flex; flex-direction: column; align-items: center; animation: ${reduce ? "none" : "drop .9s cubic-bezier(.3,1.5,.6,1) both"}; }
      .thread { width: 2px; height: 96px; background: linear-gradient(90deg, #000 0 1px, #EAF6F2 1px 2px); }
      .spider { all: unset; cursor: pointer; display: block; width: 48px; height: ${Math.round((48 * H) / W)}px; filter: drop-shadow(2px 3px 0 rgba(0,0,0,.2)); animation: ${reduce ? "none" : "sway 3.2s steps(4) 1s infinite"}; transform-origin: 50% -96px; }
      .spider svg { display: block; width: 100%; height: 100%; transform: rotate(180deg); }
      .spider:focus-visible { outline: 3px solid #3D8BFF; outline-offset: 4px; border-radius: 6px; }
      .tip { position: absolute; right: 58px; top: 104px; white-space: nowrap; background: #F7F7F8; color: #070708; border: 3px solid #070708; box-shadow: 0 0 0 2px #F7F7F8, 4px 4px 0 2px #3D8BFF; padding: 6px 10px; font-weight: 600; opacity: 0; transform: translateX(6px); transition: opacity .15s, transform .15s; pointer-events: none; }
      .wrap:hover .tip, .spider:focus-visible ~ .tip, .tip.say { opacity: 1; transform: none; }
      .close { all: unset; position: absolute; top: 96px; right: -14px; width: 18px; height: 18px; border-radius: 50%; background: #070708; color: #F7F7F8; font-size: 12px; line-height: 18px; text-align: center; cursor: pointer; opacity: 0; transition: opacity .15s; }
      .wrap:hover .close, .close:focus-visible { opacity: 1; }
      @keyframes drop { from { transform: translateY(-150px); } to { transform: none; } }
      @keyframes sway { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(4deg); } 75% { transform: rotate(-4deg); } }
    </style>
    <div class="wrap">
      <div class="thread"></div>
      <button class="spider" type="button" aria-label="Fill this application with Unnepo"><svg viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true">${spiderRects(0)}</svg></button>
      <span class="tip" role="status">Fill with Unnepo</span>
      <button class="close" type="button" aria-label="Hide the Unnepo spider on this site">×</button>
    </div>`;
  const tip = root.querySelector<HTMLElement>(".tip")!;
  const say = (words: string) => {
    tip.textContent = words;
    tip.classList.add("say");
    setTimeout(() => { tip.classList.remove("say"); tip.textContent = "Fill with Unnepo"; }, 4000);
  };
  root.querySelector(".spider")!.addEventListener("click", () => {
    let reachable = false;
    try { reachable = Boolean(chrome.runtime?.id); } catch { reachable = false; }
    // The extension was reloaded since this page opened: this copy can't reach it any more.
    if (!reachable) return say("Unnepo was updated. Refresh this page");
    try {
      chrome.runtime.sendMessage({ type: "open-panel" }).then((result: { ok?: boolean } | undefined) => {
        // Chrome only opens the panel from the toolbar sometimes; say where it is.
        if (!result?.ok) say("Click the Unnepo icon in your toolbar");
      }, () => say("Refresh this page to use Unnepo"));
    } catch {
      say("Refresh this page to use Unnepo");
    }
  });
  root.querySelector(".close")!.addEventListener("click", () => {
    try { sessionStorage.setItem(DISMISSED, "1"); } catch { /* storage off: it just hides for now */ }
    host.remove();
  });
  document.documentElement.appendChild(host);
}

function dismissed() {
  try { return sessionStorage.getItem(DISMISSED) === "1"; } catch { return false; }
}

// What a page says once an application went through. Stricter than the filler's check, since this runs on
// every job page: "Thank you for your interest" also opens many postings.
const RECEIVED = /(application (has been |was )?(successfully )?(submitted|received)|we(?:'|’| ha)?ve received your application|thank(s| you) for (applying|submitting your application)|successfully (submitted|applied)|your application is (in|complete))/i;

/**
 * Watches for the page saying the application was received or submitted, however it got there (Unnepo
 * filling it, or the student doing it all), and tells the extension once, so the spiders come out and dance.
 */
function watchForReceived() {
  let told = false;
  let pending = 0;
  const check = () => {
    pending = 0;
    if (told || !document.body) return;
    // A page still showing a form isn't the confirmation, whatever its small print says.
    const boxes = Array.from(document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=search]), textarea, select")).filter((el) => el.getBoundingClientRect().height > 0);
    if (boxes.length > 4) return;
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const match = text.match(RECEIVED);
    if (!match) return;
    told = true;
    observer.disconnect();
    const start = Math.max(0, (match.index ?? 0) - 40);
    try {
      void chrome.runtime.sendMessage({ type: "received-page", text: text.slice(start, start + 200), url: location.href }).catch(() => undefined);
    } catch {
      // The extension was reloaded; this copy of the script is cut off.
    }
  };
  const observer = new MutationObserver(() => {
    if (!pending) pending = window.setTimeout(check, 800);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  check();
}

// Notes which questions the student answers by hand, so Fill never types over them.
watchEdits();

if (window.top === window && !/(^|\.)linkedin\.com$|unneponew\.vercel\.app$|^localhost$/.test(location.hostname)) watchForReceived();

// Job sites build their pages after loading, so it checks a few times over the first half minute.
if (window.top === window && !/(^|\.)linkedin\.com$|unneponew\.vercel\.app$|^localhost$/.test(location.hostname) && !dismissed()) {
  let tries = 0;
  const check = () => {
    if (looksLikeJobPage()) return show();
    if (++tries < 15) setTimeout(check, 2000);
  };
  check();
}
