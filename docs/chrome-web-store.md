# Chrome Web Store listing

What goes in each box of the Chrome Web Store Developer Dashboard for Unnepo. Images are in `docs/store/`.

To upload an update: `npm run push` (raises the version), then `npm run extension:zip`, then Package → Upload new package with `unnepo-extension-<version>.zip` from the project root, then Submit for review.

## Store listing tab

**Name** (from the manifest): Unnepo

**Summary** (132 characters max, from the manifest's description):

> Track every job you apply to, autofill applications, write cover letters, and find who to email at each company.

**Category:** Productivity → Workflow & Planning (or Productivity → Tools)

**Language:** English (United States)

**Description:**

```
Unnepo is a job search sidekick for college students. It lives in Chrome's side panel and works on the job sites you already use: Workday, Greenhouse, Lever, Ashby, LinkedIn, Handshake, Indeed and hundreds more.

TRACK EVERY APPLICATION, AUTOMATICALLY
When a page says your application went through, Unnepo saves the job to your tracker: the title, the company, the link and the date. No spreadsheet to keep up.

FILL APPLICATIONS FASTER
Fill in your name, email, school, links and other basics from your profile in one click. Unnepo never submits for you: you review every page and press Submit yourself.

WRITE THE HARD PARTS
Get a cover letter written for the job in front of you, and answers to questions like "Why do you want to work here?" drawn from your own resume and experience.

KNOW WHO TO EMAIL
See who works at each company you applied to, and with Pro, their names and verified work emails. Unnepo reminds you when it's time to follow up and writes the follow-up for you.

SEE YOUR WEEK
A calendar of everything you did: jobs found, applications sent, emails and interviews, so you can keep a steady pace.

FREE AND PRO
Free: a 7-day Pro trial with no card, unlimited basic autofill, 3 cover letters and 5 question answers a month, and your tracker.
Pro ($25 a month or $75 a semester): unlimited cover letters, answers and smart autofill, plus names and emails at 20 companies a month.

PRIVACY
Unnepo reads only the job pages you're on, to save jobs and fill forms you open. It never reads your email, never sells your data, and never submits an application without you. Privacy policy: https://www.unnepo.com/privacy
```

**Icon:** `extension/icons/128.png` (128×128)

**Screenshots** (1280×800): `docs/store/screenshot-1.png` … `screenshot-N.png`

**Small promo tile** (440×280): `docs/store/promo-440x280.png`

**Marquee promo tile** (1400×560, optional): `docs/store/marquee-1400x560.png`

**Official URL / Homepage:** https://www.unnepo.com

**Support URL:** https://www.unnepo.com (or a support email)

## Privacy tab

**Single purpose:**

> Unnepo helps students track and apply to jobs: it saves the jobs they apply to, helps fill and write their applications, and reminds them to follow up.

**Permission justifications:**

| Permission | Why |
| --- | --- |
| `tabs` | To know which job page is open in the tab, so the side panel can show and save that job. |
| `activeTab` | To read the job page the student is on when they open Unnepo. |
| `scripting` | To fill an application form the student opened, when they click Fill, and to read the job posting on that page. |
| `sidePanel` | Unnepo's whole interface is the side panel. |
| `storage` | To keep the student's sign-in, settings, and the last few jobs it caught, on their computer. |
| `webRequest` | To notice when an application form is sent, so the job is saved to the tracker as applied. It only observes requests; it never blocks or changes them. |
| `webNavigation` | To notice the confirmation page after an application is submitted, including on job sites that change pages without reloading. |
| `alarms` | To schedule follow-up reminders and refresh the tracker. |
| `notifications` | To remind the student when it's time to follow up on an application. |
| Host permission `https://*/*` | Companies host their applications on thousands of different domains (their own careers sites and many job systems), so Unnepo needs to read the job page and fill the form on whichever site the student is applying on. It only acts on job and application pages. |

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in the package. The server only returns data, such as text the AI wrote.)

**Data usage, tick:**

- Personally identifiable information (name, school email, phone and address from the profile they fill in)
- Authentication information (the sign-in token linking the extension to their account)
- Website content (the text of job postings and application questions)
- User activity (which jobs they open, fill and submit)
- Web history (links of the job pages they applied to)

**Leave unticked:** Health, Financial and payment (Stripe handles payments on the website, not in the extension), Personal communications, Location.

**Certify all three:**

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://www.unnepo.com/privacy

## Distribution tab

- **Visibility:** Unlisted to start (only people with the link can install), then Public.
- **Regions:** All regions (or the United States only, to start).
- **Payments:** Free (Pro is sold on the website, not through the store).

## After approval

Point the site's "Get the extension" button at the store link (`https://chromewebstore.google.com/detail/<item id>`).
