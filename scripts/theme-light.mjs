// Writes app/theme-light.css: light-mode colors for every hard-coded color class (like text-[#8B8B94]) in the
// signed-in app's components. Tailwind's own colors (white, zinc-200, …) and the theme tokens (bg, card, ink, …)
// are switched in app/globals.css; this covers the [#hex] ones, which Tailwind writes out as fixed values.
//
// Runs before every `npm run build`, so a new color class is covered on the next deploy. Only applies inside an
// element with data-theme="light" (the /home app's outer box, when the student picks Light mode).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["components/unnepo", "components/onboarding", "components/ui", "components/brand", "components/product"];

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
};
for (const dir of DIRS) walk(path.join(root, dir));

// --- Colors ---------------------------------------------------------------------------------------------------
const hexToRgb = (hex) => {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((at) => parseInt(h.slice(at, at + 2), 16) / 255);
};
const rgbToHsl = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
};
const hslToHex = ([h, s, l]) => {
  const f = (n) => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
};

/** The light-mode stand-in for a dark-mode color. */
export function lightOf(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  if (s < 0.18 || l < 0.04) {
    // Greys: the near-black backgrounds turn white, borders turn light grey, and light text turns dark.
    if (l < 0.1) return hslToHex([h, s, Math.min(1, 0.955 + (l - 0.03) * 3)]);
    if (l < 0.3) return hslToHex([h, s, 1 - l * 0.75]);
    return hslToHex([h, s, 1 - l]);
  }
  // Colors: dark tinted backgrounds become pale tints; bright accents darken enough to read on white.
  if (l < 0.3) return hslToHex([h, Math.min(s, 0.6), 0.94]);
  return hslToHex([h, s, Math.min(l, 0.38)]);
}

// --- Classes --------------------------------------------------------------------------------------------------
const PROPS = {
  bg: "background-color", text: "color", border: "border-color", "border-t": "border-top-color", "border-b": "border-bottom-color",
  "border-l": "border-left-color", "border-r": "border-right-color", "border-x": "border-inline-color", "border-y": "border-block-color",
  outline: "outline-color", fill: "fill", stroke: "stroke", decoration: "text-decoration-color", caret: "caret-color", accent: "accent-color",
  ring: "--tw-ring-color", shadow: "--tw-shadow-color", from: "--tw-gradient-from", via: "--tw-gradient-via", to: "--tw-gradient-to",
};
const PSEUDO = { hover: ":hover", focus: ":focus", "focus-visible": ":focus-visible", "focus-within": ":focus-within", active: ":active", disabled: ":disabled" };
const MEDIA = { sm: "40rem", md: "48rem", lg: "64rem", xl: "80rem", "2xl": "96rem" };
const escapeClass = (name) => name.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);

const pattern = /(?<![\w-])((?:[a-z0-9-]+:)*)(bg|text|border(?:-[tblrxy])?|outline|fill|stroke|decoration|caret|accent|ring|shadow|from|via|to|placeholder)-\[(#[0-9A-Fa-f]{3,6})\](?:\/(\d{1,3}|\[[0-9.]+\]))?/g;
const rules = new Map();
const chromaticBg = new Set();
for (const file of files) {
  for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
    const [whole, variantText, utility, hex, alpha] = match;
    const variants = variantText.split(":").filter(Boolean);
    let pseudo = "", media = "", group = "", ok = true;
    for (const variant of variants) {
      if (PSEUDO[variant]) pseudo += PSEUDO[variant];
      else if (MEDIA[variant]) media = MEDIA[variant];
      else if (variant === "group-hover") group = ".group:hover ";
      else if (variant === "placeholder") pseudo += "::placeholder";
      else ok = false;
    }
    if (!ok) continue;
    const [r, g, b] = hexToRgb(lightOf(hex)).map((v) => Math.round(v * 255));
    // An opacity: /60, or /[0.07].
    const opacity = alpha ? (alpha.startsWith("[") ? Number(alpha.slice(1, -1)) : Number(alpha) / 100) : 1;
    const color = opacity < 1 ? `rgb(${r} ${g} ${b} / ${opacity})` : lightOf(hex);
    const property = utility === "placeholder" ? "color" : PROPS[utility];
    const selector = `[data-theme="light"] ${group}.${escapeClass(whole)}${utility === "placeholder" ? "::placeholder" : ""}${pseudo}`;
    const rule = `${selector} { ${property}: ${color}; }`;
    rules.set(media ? `@media (width >= ${media}) { ${rule} }` : rule, true);
    const [, s, l] = rgbToHsl(hexToRgb(hex));
    if (utility === "bg" && !variants.length && !alpha && s >= 0.18 && l >= 0.3) chromaticBg.add(whole);
  }
}
// A white or black label on a colored button stays white, though white and black swap everywhere else.
const onColor = [...chromaticBg].sort().map((name) => `[data-theme="light"] .${escapeClass(name)}:is(.text-white, .text-black)`);

const css = `/* Generated by scripts/theme-light.mjs on each build. Don't edit: change the script or the components. */\n${[...rules.keys()].sort().join("\n")}\n${onColor.length ? `${onColor.join(",\n")} { color: #fff; }\n` : ""}`;
writeFileSync(path.join(root, "app/theme-light.css"), css);
console.log(`Wrote app/theme-light.css: ${rules.size} light-mode colors.`);
