# Design

## Files
- `home-spider.html` — **the new landing page**, standalone and working. Open it in a browser. Port this into `components/marketing/landing.tsx`.
- `mockups/*.dc.html` — reference mockups for every screen. They use a design-canvas template format (`{{holes}}`, `<sc-for>`, `<sc-if>`, a `Component` class with `renderVals()`), so they won't run on their own; read them for layout, copy, spacing, and colors.
  - `Main.dc.html` — home page (same as home-spider.html)
  - `Extension.dc.html` — extension side panel, 400×780 (batch progress, per-job status, Submit all ready)
  - `Applied.dc.html` — applied jobs tracker
  - `People.dc.html` — unlock people at a company + email draft
  - `Stats.dc.html` — stats page
  - `Jobs.dc.html` — jobs you may like
- Company names, people, and numbers in the mockups are made-up sample data.

## Tokens
| Token | Value | Use |
|---|---|---|
| bg | `#070708` | page background |
| surface | `#0C0C0E` / `#111114` | cards, selected rows |
| border | `#17171B` (hairline), `#1F1F24`, `#26262C` (controls) | dividers, buttons |
| fg | `#F7F7F8` | text, primary buttons |
| muted | `#8B8B94` (passes 4.5:1), `#9A9AA3`, `#B4B4BC` | secondary text |
| accent | `#3D8BFF` | brand blue, the dot in "unnepo.", highlights |
| warning | `#F5A524` | "needs you" states |
| success | `#4ADE80` | offer status |
| spider palette | `#6E5B6E` body, `#B48FAE` highlight, `#4E3549` shade, `#7E6580` head, `#965E8C` tongue, `#1A0E14` mouth | pixel spider |

- Fonts: **Geist** (UI), **Geist Mono** (labels, numbers, uppercase eyebrows with ~1.2px tracking), **Press Start 2P** (home dialogue box, name tag, CTA only).
- Headings: Geist 700, tight tracking (−1.4px at 40px).
- Buttons: primary = white fill, black text, 10–12px radius, ≥44px tall; secondary = 1px `#26262C` border. Pills for filters (36px).
- Minimal: hairline dividers instead of cards wherever possible; no gradients, no emoji.
- Home page dialogue box: white box, 4px black border, 4px white outer ring, hard offset shadow; blue "UNNEPO" name tag; blinking ▼ when a line finishes; click to skip/advance; respects reduced motion.
