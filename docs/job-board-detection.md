# Job board detection: 7 sites, how Unnepo reads them, and how to make it better

How the extension knows (1) which job the student has open and (2) that they applied, on the seven boards students use most: LinkedIn, Indeed, Handshake, ZipRecruiter, Glassdoor, Wellfound and Dice.

**How sure each point is.** Each point is marked:
- **[docs]**: a public page says so (see Sources).
- **[seen]**: how the site behaved as of mid-2026, from memory. Check it on the live site before relying on it.
- **[test]**: unknown, so test it live.

Job boards change their pages often. Treat every **[seen]** point as something to re-check in the live test pass below.

---

## What Unnepo does on every board (as of V1.019)

**Which job is open.**
- `openedJob()` in `extension/src/content/scan.ts` starts at the Apply button. That is the one the student pressed, marked on the page as `data-unnepo-pressed`; if nothing was pressed, it uses the Apply button in the largest box.
- From there it climbs to the largest box that still links to at most one job. That box is the job's details pane, not the results list.
- The pane's top heading is the job title. The company comes from, in order:
  1. The board's posting data, when it names the same job.
  2. An employer link or label inside the pane.
  3. The page title.
  4. The logo's alt text.
  5. The short line under the heading.
- If there's no pane, it uses posting data (only when the page has a single posting), then the result the board marks as selected, then the page title.
- Every board in `QUICK_BOARDS` uses this, for both automatic saving and the panel's **✓ I applied to this job** button.

**That they applied.** Each check is recorded in the Activity view as a "how" value:

| Check | Activity `how` |
|---|---|
| The pressed button turns into "Applied", or a short new "Applied / Application sent" label appears | `button_changed` |
| A POST to an apply address within a minute of a final press (1-Click, Submit) | `board_saved` |
| The page says "application received / submitted" | `page_said` |
| A LinkedIn Easy Apply request address | `linkedin_easy_apply` |
| The student presses ✓ I applied | `you_marked` |

**When nothing confirms it.**
- The job goes on the "Did you apply?" list.
- The spiders only celebrate after the job is saved in the tracker.
- A failed save is retried once, then goes on the "Did you apply?" list.

**The job's link.**
- On Indeed, a search page with a job open (`?vjk=`) is saved as that job's own page: `/viewjob?jk=`.
- When Apply opens the company's site, the board posting is kept as the job's link (`fillReport.postingUrl`). The company form is kept as "Application".

---

## 1. LinkedIn

| | |
|---|---|
| Open job | Search shows a results list plus a details pane. The open job is `currentJobId=<id>` in the address; a job's own page is `/jobs/view/<id>` **[seen]** |
| Apply types | Easy Apply (a LinkedIn modal of several steps, ending in "Submit application"), or Apply that opens the company's site **[seen]** |
| Confirmation | A modal or toast saying "Your application was sent" **[seen]** |
| Unnepo | **Never reads LinkedIn pages** (`NEVER_READ`). It uses only the tab title ("Growth Intern \| MealPal \| LinkedIn"), the address, and the address of the request Easy Apply sends (`LINKEDIN_APPLY`) |

**Gaps**
- The Easy Apply request pattern is a guess **[test]**.
- When the company's site opens from LinkedIn, the job is kept from the tab title. The company tab's own page then gives the details.

**Fixes to try**
1. Live-test Easy Apply with the extension's Activity log open. Record which request address fired, and tighten `LINKEDIN_APPLY` to it.
2. Pass the LinkedIn job's `/jobs/view/<id>` link to the company tab as its `postingUrl`. Today the tab title gives the job, but not the link.

## 2. Indeed

| | |
|---|---|
| Open job | Search `/jobs?q=…&vjk=<id>` shows a results list plus a details pane. A job's own page is `/viewjob?jk=<id>` **[seen]** |
| Apply types | "Apply now" with Indeed's own form (Indeed Apply), or "Apply on company site" **[seen]**. Indeed Apply can send applicants to an employer's Continue address after the post-apply screen **[docs]** |
| Confirmation | Indeed Apply ends on a post-apply screen ("Your application has been submitted") **[docs: a post-apply screen exists; wording seen]**. The form runs on Indeed's apply site, often in a new tab **[test: which host]** |
| Unnepo | Watches Indeed (`QUICK_BOARDS`). Reads the open job from the pane. Saves `/viewjob?jk=` as the link |

**Gaps**
- If Indeed Apply opens a new tab on another Indeed host, the job has to carry over from the opener tab. That works through `seen` and `openerTabId`, but only if the job was read before Apply was pressed.

**Fixes to try**
1. Check whether the apply host is `smartapply.indeed.com` or another, and whether it matches `QUICK_BOARDS` (it does if it ends in `indeed.com`). Make sure the "submitted" screen matches `RECEIVED` in `launcher.ts`.
2. Read the job when Apply is pressed. This already happens via `apply-clicked` and `look()`.

## 3. Handshake

| | |
|---|---|
| Open job | `/job-search/<id>` shows the results plus a details pane. `/jobs/<id>` or `/stu/jobs/<id>` is the job's page **[seen]** |
| Apply types | "Apply" opens a step for choosing documents, then "Submit application". "Apply externally" goes to the company's site **[seen]** |
| Confirmation | Handshake lists applied jobs under My jobs / Applications with the status "Applied", which is "the initial status for all applications" **[docs]** |
| Unnepo | `handshakeJob()` reads the pane; this came first and `openedJob()` builds on it |

**Fixes to try**
1. As a backstop, read the student's Applications page while they're on it (it's their own list). Any job listed "Applied" that isn't in the tracker gets added. This catches everything the live detection missed **[test: the page layout]**.
2. Confirm that the Submit step's request address matches `BOARD_APPLY`.

## 4. ZipRecruiter

| | |
|---|---|
| Open job | The job's page is `/c/<Company>/Job/<Title>/-in-<Place>?jid=<id>`. Search can show a pane with `jid` (or `lvk`) in the address **[docs: jid in job links; lvk seen]** |
| Apply types | "1-Click Apply" applies with the saved resume at once. Otherwise a short form, or the company's site **[docs: 1-Click uses the existing resume]** |
| Confirmation | The button turns into "Applied". Results show "Applied" badges **[seen]** |
| Unnepo | 1-Click is caught by `button_changed`. Job pages carry posting data **[seen]** |

**Fixes to try**
1. Live-test 1-Click from a search page, not a job page. The pane reader should pick the pressed job, not the first result (the practice page `search-pane.html` covers this layout).

## 5. Glassdoor

| | |
|---|---|
| Open job | Search shows a results list plus a details pane. The job id is in the address (`jl=` or `jobListingId=`) **[seen]** |
| Apply types | "Easy Apply" uses Indeed's Easy Apply form **[docs]**. "Apply on employer site" goes to the company **[seen]** |
| Confirmation | Indeed's post-apply screen, inside Glassdoor or a new tab **[test]** |
| Unnepo | Watches Glassdoor and reads the pane |

**Fixes to try**
1. Because Easy Apply is Indeed's form, a Glassdoor job may end on an Indeed host. Make sure the opener-tab carry-over keeps the Glassdoor posting as `postingUrl` **[test]**.
2. Add `jl` and `jobListingId` to the canonical link, once a live link confirms the format.

## 6. Wellfound (formerly AngelList Talent)

| | |
|---|---|
| Open job | `/jobs/<id>-<slug>`. Search can open a job in a modal or a pane **[seen]**. A link with `autoOpenApplication=true` opens the application directly **[docs: a scraper's sample output]** |
| Apply types | A modal with a note to the company and "Send application". It can't be undone once sent **[docs]** |
| Confirmation | The modal closes or shows "Application sent", and the job shows "Applied" **[seen]** |
| Unnepo | Watches Wellfound. "Send application" counts as a final press |

**Fixes to try**
1. The modal is a dialog. Make sure `openedJob()` climbs from the Send button in the dialog to the job's pane, not just the dialog (the dialog often lacks the job title). If the dialog has no heading, use the job that was marked when Apply was first pressed **[test]**.

## 7. Dice

| | |
|---|---|
| Open job | `/job-detail/<uuid>` **[seen]** |
| Apply types | "Easy Apply": attach or review the resume and cover letter in Dice's own steps. "Apply now" sends you to the employer's site **[docs]** |
| Confirmation | Easy Apply ends on a page saying the application was submitted **[seen]** |
| Unnepo | Watches Dice. Its job pages carry posting data **[seen]** |

**Fixes to try**
1. Dice doesn't accept plain-text cover letters **[docs]**. If Unnepo attaches one there, it should be the PDF.

---

## The test and fix loop

**1. Practice pages (`tests/practice/pages`), run in the browser with `window.openedJob()` and `window.quickMessages`:**

| Page | Covers |
|---|---|
| `search-pane.html` | Results plus a pane, with posting data for every result |
| `quick-apply.html` | 1-Click turning into "Applied", and a form whose Submit says "Application sent" |

Add one page per layout that fails live, copying the structure (never real content), so a fix stays fixed.

**2. Live pass, once a week or after a board changes.** For each of the seven boards:
1. Open a search and pick the third result.
2. Press **✓ I applied to this job**. Check the title, company and link it reads, then press Cancel.
3. Apply to one real job you mean to apply to.
4. Check the Activity view for how it was caught.
5. If nothing caught it, press **It missed an application** on that page. This saves the page's buttons, headings and recent Activity log to the issues list.

**3. Measure.**
- The Activity view's **By site** table shows each site's **auto-confirmed** share.
- Under 70% means that board's detection needs work: fix the lowest one first.
- "Did you apply?" answers count as misses. ✓ means a confirmation was missed; ✕ means an Apply press was mistaken for applying.

**4. Fix.**
1. Read that site's "missed one" reports.
2. Change the pattern: `APPLY_PRESS`, `APPLIED_NOW`, `RECEIVED`, `BOARD_APPLY` or the pane reader.
3. Add a practice page or unit test for it.
4. Ship.
5. Watch the share move the next week.

## Sources

- [Indeed: Apply with Indeed (post-apply screen and Continue address)](https://docs.indeed.com/indeed-apply/apply-with-indeed)
- [Indeed: using finishAppUrl](https://docs.indeed.com/indeed-apply/using-the-finishappurl-parameter)
- [Careerist: how to use Glassdoor (Easy Apply uses Indeed's form)](https://support.careerist.com/knowledge/how-to-use-glassdoor)
- [Handshake: application statuses and My jobs](https://support.joinhandshake.com/hc/en-us/articles/115000757708)
- [Apify: ZipRecruiter job links with jid](https://apify.com/crowdpull/crowdpull-ziprecruiter-jobs-scraper)
- [ConductAtlas: ZipRecruiter 1-Click Apply uses your existing resume](https://conductatlas.com/platform/ziprecruiter/ziprecruiter-privacy-policy/1-click-apply-automatically-uses-existing-resume/)
- [Wellfound: how do I apply to a job?](https://help.wellfound.com/article/769-how-do-i-apply-to-a-job)
- [AngelList (Wellfound) help: applications can't be undone](https://help.angel.co/article/84-how-do-i-apply-to-a-job)
- [Apify: Wellfound job listings (autoOpenApplication)](https://apify.com/radeance/wellfound-job-listings-scraper)
- [Careerist: how to apply on Dice (Easy Apply vs Apply now, cover letters)](https://support.careerist.com/knowledge/how-to-use-dice)
