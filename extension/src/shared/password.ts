/**
 * The student's job-site password: one strong password the extension types whenever a job site asks to
 * create an account or sign in (Workday and friends). It lives only in chrome.storage.local on this
 * computer and is never sent to Unnepo.
 */

const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
// Specials nearly every job site accepts. Some reject quotes, spaces, or angle brackets.
const SPECIAL = "!@#$%*?";

/** The rules job sites ask for, in the words they use. */
export const PASSWORD_RULES: Array<{ label: string; test: (value: string) => boolean }> = [
  { label: "A numeric character", test: (value) => /\d/.test(value) },
  { label: "An uppercase character", test: (value) => /[A-Z]/.test(value) },
  { label: "An alphabetic character", test: (value) => /[A-Za-z]/.test(value) },
  { label: "A special character", test: (value) => /[^A-Za-z0-9\s]/.test(value) },
  { label: "A lowercase character", test: (value) => /[a-z]/.test(value) },
  { label: "A minimum of 8 characters", test: (value) => value.length >= 8 },
];

/** The rules a password doesn't meet yet; empty when it's good to use. */
export function unmetRules(value: string) {
  return PASSWORD_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.label);
}

function randomIndex(max: number) {
  // Rejection sampling so every character is equally likely.
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % max;
  }
}

/** A random password with at least one of each kind, 16 characters by default. */
export function generatePassword(length = 16) {
  const all = LOWER + UPPER + DIGITS + SPECIAL;
  const chars = [LOWER, UPPER, DIGITS, SPECIAL].map((set) => set[randomIndex(set.length)]);
  while (chars.length < Math.max(length, 8)) chars.push(all[randomIndex(all.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1);
    [chars[index], chars[other]] = [chars[other], chars[index]];
  }
  return chars.join("");
}
