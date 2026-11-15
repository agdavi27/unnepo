/**
 * Light or dark, for the side panel and the dashboard. Kept in chrome.storage so a page opens in the right one
 * at once; the account holds the real choice (Me → Light mode, or Settings on unnepo.com), and it comes back with
 * the student's account each time the panel loads.
 */
export type Theme = "light" | "dark";

let current: Theme = "dark";
export const theme = () => current;

const listeners: Array<() => void> = [];
/** Runs after the theme changes, for things drawn once rather than on every redraw (the panel's spider). */
export const onThemeChange = (listener: () => void) => { listeners.push(listener); };

function apply(next: Theme) {
  const changed = next !== current;
  current = next;
  if (next === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  if (changed) for (const listener of listeners) listener();
}

/** Puts the saved theme on the page now, and follows it when it changes anywhere (another panel, the account). */
export function startTheme() {
  void chrome.storage.local.get("theme").then((stored) => apply(stored.theme === "light" ? "light" : "dark"));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.theme) apply(changes.theme.newValue === "light" ? "light" : "dark");
  });
}

/**
 * The account's theme, when it arrives with the account. Followed only when the account's value changes, so an
 * older copy of the account, read just before the switch was flipped, can't flip it back.
 */
let lastAccount: Theme | undefined;
export function accountTheme(value: Theme | undefined) {
  if (!value || value === lastAccount) return;
  lastAccount = value;
  if (value === current) return;
  apply(value);
  void chrome.storage.local.set({ theme: value });
}

/** The student flipped the switch: shown at once, then saved to the account. */
export function chooseTheme(value: Theme) {
  apply(value);
  void chrome.storage.local.set({ theme: value });
  void chrome.runtime.sendMessage({ type: "set-theme", theme: value }).catch(() => undefined);
}
