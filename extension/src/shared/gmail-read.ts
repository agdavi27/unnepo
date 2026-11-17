/**
 * Runs inside a Gmail tab opened on a search (Scan my email): waits for the results, then reads each row's sender,
 * subject, preview line, date and thread. Nothing is clicked or opened. Self-contained (chrome.scripting injects
 * the function by itself), so it uses nothing from outside.
 */
export async function readGmailResults(): Promise<{ state: "ok" | "signin" | "timeout"; rows: Array<{ id: string; fromName: string; fromEmail: string; subject: string; snippet: string; at: number; url: string }> }> {
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  if (!/mail\.google\.com$/.test(location.hostname)) return { state: "signin", rows: [] };
  const shown = (el: Element) => (el as HTMLElement).offsetParent !== null;
  const rowsNow = () => Array.from(document.querySelectorAll<HTMLTableRowElement>('div[role="main"] tr.zA')).filter(shown);
  const empty = () => Array.from(document.querySelectorAll('div[role="main"] td.TC')).some((cell) => shown(cell) && /no messages matched/i.test(cell.textContent ?? ""));
  // Gmail draws the search a moment after the page loads: wait until rows (or "No messages matched") and they stop changing.
  let last = -1;
  let still = 0;
  // Gmail with Chat on can open a search on its Conversations or Spaces tab: the Mail tab is where the emails are.
  const mailTab = () => Array.from(document.querySelectorAll<HTMLElement>('[role="button"], [role="tab"]')).find((el) => shown(el) && el.textContent?.trim() === "Mail");
  const conversationsShown = () => Array.from(document.querySelectorAll<HTMLElement>('[role="button"], [role="tab"]')).some((el) => shown(el) && el.textContent?.trim() === "Conversations");
  for (let tries = 0; tries < 60; tries += 1) {
    await sleep(500);
    if (empty()) return { state: "ok", rows: [] };
    if (tries % 4 === 3 && !rowsNow().length && conversationsShown()) {
      const tab = mailTab();
      if (tab) for (const type of ["mousedown", "mouseup", "click"]) tab.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    const count = rowsNow().length;
    if (count && count === last) still += 1;
    else still = 0;
    last = count;
    if (count && still >= 2) break;
  }
  const rows = rowsNow();
  if (!rows.length) return { state: "timeout", rows: [] };
  const account = /\/mail\/u\/(\d+)/.exec(location.pathname)?.[1] ?? "0";
  return {
    state: "ok",
    rows: rows.slice(0, 100).map((row) => {
      // The newest sender in the thread is the last name shown.
      const senders = Array.from(row.querySelectorAll<HTMLElement>("span[email]"));
      const sender = senders[senders.length - 1];
      const subjectEl = row.querySelector<HTMLElement>("span.bog");
      const thread = row.querySelector<HTMLElement>("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id")
        ?? row.querySelector<HTMLElement>("[data-thread-id]")?.getAttribute("data-thread-id")?.replace(/^#?thread-f:/, "") ?? "";
      const dateTitle = row.querySelector<HTMLElement>("td.xW span[title], td.xW [title]")?.getAttribute("title") ?? "";
      const parsed = Date.parse(dateTitle.replace(/ at /, " ").replace(/\u202f/g, " "));
      const subject = (subjectEl?.textContent ?? "").trim();
      const snippet = (row.querySelector<HTMLElement>("span.y2")?.textContent ?? "").replace(/^\s*[-–]\s*/, "").trim();
      const fromEmail = sender?.getAttribute("email") ?? "";
      return {
        id: thread || `${fromEmail}|${subject}`,
        fromName: (sender?.getAttribute("name") || sender?.textContent || "").trim(),
        fromEmail,
        subject,
        snippet,
        at: Number.isNaN(parsed) ? Date.now() : parsed,
        url: thread ? `https://mail.google.com/mail/u/${account}/#all/${thread}` : `https://mail.google.com/mail/u/${account}/#search/${encodeURIComponent(subject)}`,
      };
    }),
  };
}
