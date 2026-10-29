# Unnepo handoff

Everything from the planning chat, packaged for Claude Code.

## How to use
1. Copy this whole `unnepo-handoff` folder into the root of your `unnepo` repo.
2. Open Claude Code in the repo.
3. Paste the prompt from `START_HERE.md`.

## What's inside
- `START_HERE.md` — the master prompt with build phases
- `docs/decisions.md` — every decision we made (extension pivot, passwords, CAPTCHAs, emails, costs, what to delete, onboarding style)
- `docs/repo-audit.md` — file-by-file audit of the current repo: delete / keep / replace
- `docs/architecture.md` — full extension + backend spec
- `docs/onboarding-spec.md` — resume-first "getting to know you" flow and profile schema
- `docs/research.md` — why it was slow, ATS APIs, costs, sources
- `design/home-spider.html` — the new landing page (pixel spider + dialogue box), works standalone
- `design/mockups/` — mockups for the extension side panel, Applied, People, Stats, Jobs
- `design/README.md` — colors, fonts, component styles

## Before Claude can push
Install the Claude GitHub App on `agdavi27/unnepo` (github.com/apps/claude) or reconnect GitHub under claude.ai Settings → Connectors. Claude Code running on your own machine can push with your normal git credentials.
