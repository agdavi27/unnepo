/**
 * A gift code waiting to be used, kept in this browser from the moment /gift/redeem opens until the student uses or
 * dismisses it. It survives every way of signing up (email, verifying from the inbox, Google) and onboarding, which
 * a ?next= link does not. Never redeemed on its own: a parent opening their own gift link must not use it up.
 */
const KEY = "unnepo:gift";

export function rememberGift(code: string) {
  try { if (code) localStorage.setItem(KEY, code.slice(0, 20)); } catch { /* storage blocked */ }
}

export function pendingGift() {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}

export function forgetGift() {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
