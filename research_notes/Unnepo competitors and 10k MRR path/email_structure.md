# Short cold emails and follow-ups after applying: what the evidence says

Researched 2026-11-23. Scope: a US college student who has applied (or is about to apply) for an internship or entry-level role and emails a recruiter, hiring manager, alum, or employee at that company. The output feeds the prompt for Unnepo's AI email writer, so the last section is a list of testable rules.

## How much to trust each source

Almost every quantitative source here is a **vendor selling email software** (Boomerang, Lavender, Gong, Hunter, Woodpecker, Belkins, Instantly, Yesware, Reply.io, Whali). Keep three cautions in mind:

1. **It's B2B sales data, not job-seeker data.** A student asking an alum for 15 minutes is a much easier yes than a sales pitch. Absolute reply rates do not transfer. Student-to-alum rates are commonly reported at 20-30% (Offerloop, vendor, unverified), while B2B cold email gets 0.45-5%. Directional findings (shorter is better, one ask, follow up once or twice) do transfer.
2. **Numbers conflict across vendors** because they define "reply" differently (per email vs per sequence, with or without auto-replies) and filter differently. Belkins alone reported an 8.4% single-email reply rate for 2024 and 0.45% per email for 2025.
3. **Correlation, not causation.** Only Gong's CTA study and Boomerang's sign-off study come close to isolating a variable, and both are still observational.

The one student-specific dataset (Whali, 6,337 student emails, Nov 2025 to May 2026) is small, mostly UK/EU, comes from a vendor, and under-counts replies.

---

## 1. Length

| Source (collector) | Data | Finding |
|---|---|---|
| **Boomerang** (2016, 40M+ emails, mostly warm email) | Response rate by word count | 50-125 words all had >50% response. 125 words ≈ 50%, 500 words ≈ 44%, 25 words ≈ 44%, 10 words ≈ 30% lower. This is the origin of the "50-125 words" rule. Hunter calls it outdated for cold email. |
| **Hunter** (34M cold emails, 2022-2024) | Reply rate by 20-word band | Best band was **20-39 words (4.5%)**. Under 100 words averaged 3.9% vs 3.7% for longer. Hunter's own conclusion is that the effect is small and length is not a silver bullet. |
| **Hunter** State of Cold Email 2025 (11M emails, 2024) | Correlation | Word count vs reply r = -0.09 (weak). Suggests 40-60 words, plain text. |
| **Gong** Labs (28M+ cold emails, July 2025) | Reply rate | Ideal is **≤100 words**. Highest reply rates come from **3-4 sentences**. Pitching cuts replies by up to 57%. |
| **Instantly** 2026 benchmark (2025 data, "billions" of interactions) | Sequence analysis | The best sequences keep **each email under 80 words**. |
| **Reply.io** (vendor research) | Reply rate | 50-70 words got about 9% more replies. |
| **Whali** (6,336 student emails, Nov 2025 to May 2026) | Reply rate by band | **<100 words: 11.9% (n=59 only)**, 100-200: 1.9%, 200-300: 0.3%. This is where the "11.9% vs 1.9%" claim comes from. Small sample, vendor data, and the gap is far larger than any other study shows. Treat it as directional. |
| **Steve Dalton**, *The 2-Hour Job Search* (career method, not data) | Rules | "6-Point Email": **under 75 words**. Some career centers call it the "5-Point Email" with an under-100-word limit. |
| **BYU Career Services** | Guidance | Under 75 words. Quantic says ≤150, and shorter is better for mobile. |

**Conclusion:** Aim for **50-90 words** in the body (sweet spot 60-80). Never exceed 100 for a first email or 60 for a follow-up. Going below about 35 words makes a cold email too thin for a stranger to act on, and Boomerang shows very short emails also lose. Most of the gain comes from **cutting self-description**, not from shaving words.

## 2. Subject lines

| Source | Finding |
|---|---|
| **Boomerang** (40M) | **3-4 words** was best. Replies fell as words were added. No subject line: 14%. |
| **Belkins** (5.5M+ cold emails, 2024, published Aug 2025; secondary reporting) | **2-4 words** had the highest open rate (46%). 10 words: 34%. Personalized subject: 46% open vs 35%, and reply rate is reported going from 3% to 7%. |
| **Lavender** (tips posts, no sample sizes) | Short subjects work best. **Questions** in the subject "scream pitch" and are claimed to cut opens by about 56%. **Numbers/metrics** are claimed to cut opens by about 46%. All examples are in sentence case. |
| **Gong** (28M) | Avoid numbers and questions in subjects. Buzzwords and numbers cut opens by up to 17.9%. |
| **Reply.io** test | An **all-lowercase** variant got 3.46% fewer opens and 11% fewer replies, which contradicts the "lowercase wins" folklore. An unsourced aggregator claims lowercase is +21%. Unresolved, so use sentence case. |
| **Whali** (students) | Subjects **under 30 characters** had 83.7% opens vs 69.5% at 70+ characters. Including "student" scored lower (72.1%). Em dashes scored lower (71.2%). These are open rates inflated by Apple Mail Privacy Protection, so use them for relative comparisons only. |
| **Career centers** (Tufts, Dartmouth, St. Thomas, Hamilton, Mines, Stanford) | Put the **shared school** or **referrer's name** in the subject for alumni ("Dartmouth student seeking advice", "Referral from Professor Wright"). Recruiter templates (Yale SOM) name **role + company**. |
| **Dalton** | Never mention jobs in the subject or body of a networking email. Describe their role or company in plain words. |

**Conclusion:** Use **2-5 words, under 40 characters, sentence case, no question mark, no numbers except a req ID when emailing a recruiter, no "!"**. Lead with the strongest relevance token: the school for alumni, the role for recruiters, the team or project for hiring managers and peers. Examples: "Fellow Wolverine, quick question", "Data analyst intern applicant", "Your post on the risk team".

## 3. Structure that works

### Opening line
- Dalton's rule is that **the connection goes first**. Open with the reason it's *this person*: shared school, a referrer, or something specific they wrote or built. Stanford Alumni and the Daily Pennsylvanian say the same: name the common ground immediately.
- Lavender data via Something Inc. (231,818 emails, Feb 2026): personalized emails get **50-250% higher reply rates** than templated ones, but only when the detail is *relevant*. Scraped "I noticed [Company] recently expanded" lines read as AI and don't help.
- Hunter: emails with **two custom attributes** get about **56% higher replies**. Small segments (≤50 recipients) reply at 5.8% vs 2.1% for 1,000+ blasts.

### The ask
- **Gong** (304,174 emails, 2021): **interest-based CTAs** ("Open to…?", "Would it be worth…?") had a **30% meeting success rate vs 15% for a specific time ask** and 13% for open-ended. Once a prospect is engaged, this reverses: specific asks win 37% vs 25%. For students, the first email should ask *whether they're open to* a short chat. Once they reply, offer specific times (Daily Pennsylvanian: propose a few times).
- **Size of the ask:** Stanford Alumni recommends about 20 minutes, with a 15-minute fallback in the follow-up. Dalton recommends a short call framed as a question. Use **10-15 minutes**. "Any advice?" is vague and makes the reader do the work.
- **Referral asks:** Career centers and Dalton say **don't ask a stranger for a job or referral in email #1** (Stanford: never ask an alum for a job). Referrals still matter a great deal: Lever found 1 in 16 referred candidates hired vs 1 in 152 from the careers site, and Glassdoor finds a smaller but significant uplift. Get the referral *after* the conversation. Exception: if you already applied and the recipient is a peer on the team, a soft "Would you be comfortable passing my name to the hiring team?" works only after rapport. Never use it as the opener to a stranger.
- **One CTA only.** Boomerang found 1-3 questions got 50% more responses than zero. Reply.io found emails with *no* questions did 11% better, but in sales, where questions are usually pitches. Gong's 3-4 sentence finding leaves no room for more than one ask. Rule: **exactly one question, and it's the CTA**.
- **Other-focused framing:** Dalton says the email is about them, not you, and to generalize your interest. Gong found pitching cuts replies by up to 57%. In a student email, a résumé recital is the pitch.

### Application details, attachments, links
- **Recruiters:** name the **exact role title and location/team**, and add the req ID if known. SentinelOne's recruiting team recommends including the job link or title and the location or team. A recruiter-side article (ClearanceJobs) notes req IDs are internal, which is exactly why recruiters can look you up faster with one. Say you've **already applied** so the reader doesn't think you're asking them to do it for you.
- **Alumni and peers:** don't lead with the application. Dalton says no mention of jobs. It's fine to mention it in a single clause if you've applied, since otherwise the chat looks like a stealth ask.
- **Attachments:** Yale SOM's recruiter templates attach the résumé. Hunter found images and links have no significant effect on replies, but tracking pixels lower them. Rule: **no attachment in a networking email**. For a recruiter after applying, a résumé **attachment is acceptable** (they will want it). Otherwise say "happy to send my résumé". At most **one link** (LinkedIn or the posting) in the signature, not the body.
- **Thank-you close:** Boomerang (350k advice-seeking threads) found closings with gratitude got **62% vs 46%** replies. "Thanks in advance" had the highest rate (65.7%), "Thanks" 63%, "Best" 51%. This is the most student-relevant study because the emails were *asking for help*.

## 4. Tailoring by recipient type

| Recipient | Their incentive | Opening hook | Ask | Mention application? | Length |
|---|---|---|---|---|---|
| **Recruiter / university recruiter** | Fill reqs efficiently. Hundreds of InMails a week (Blind recruiter commentary). | Role + "I applied on [date]" + the 1-2 facts that match the posting | "Is there anything else useful for your review?" or "Would a quick call help?", or simply flag fit. Don't ask for a coffee chat about their career. | **Yes**: exact title, location/team, req ID if known | 50-80 words |
| **Hiring manager** | Hire someone who can do the work | Something specific about their team's work or product + one proof point that maps to it (a project, not a GPA list) | Interest CTA: "Open to a 10-minute chat about the team?" | Yes, briefly ("I applied for X") | 60-90 words |
| **Alum** | Wants to help their school ("booster" tendency, Dalton) | **School first** (subject + line 1), class year, major | 15-minute chat about their path. Never a job or referral in email #1. | Optional, one clause at most | 50-80 words |
| **Peer engineer / analyst** | Low authority, high candor. May get a referral bonus. | Shared background or a specific thing they built or wrote | 10-15 minutes on what the work is really like. Referral only after a conversation. | Optional, one clause | 50-80 words |

**Industry:**
- **Finance (IB, PE, S&T) and consulting:** networking is *expected* and structured. Alumni calls feed directly into referrals and first-round invites. Use school-first subject lines; WSO, Michigan's "Banking at Michigan" guide, and PrepLounge all recommend "[School] student — quick question" styles. Be concise and formal-ish ("Hi Mr./Ms." is not needed; "Hi Sarah" is standard). Email well **before** the deadline: recruiting runs 12-18 months ahead for junior IB. Follow-ups are normal. Lavender's benchmark shows finance recipients reward quality the most: **A-grade emails get +79% lift**, the highest of any persona.
- **Tech:** hiring is ATS and referral-driven, and recruiters and engineers are informal. Lead with something concrete you built that relates to their product. Engineers dislike flattery. Lavender: engineering/product reply rate is 5.2% for A-grade emails. Ask peers for "what the team is like", and convert to a referral after the chat.
- **Other** (marketing, nonprofit, government, healthcare): a softer informational-interview frame works. Government and large employers often route everything through the portal, so recruiter emails matter less. Use the alumni route.

## 5. Follow-ups

| Source | Finding |
|---|---|
| **Woodpecker** (older platform study) | No follow-ups: about 9% replies. With ≥1 follow-up: about 13%. Experienced users: 16% → 27%. Optimal is **2-3 follow-ups**, and the **first follow-up gets the most**. Newer Woodpecker benchmarks (1,020 companies): email 4 gets about half of email 1's replies. |
| **Hunter** 2025 (11M) | With follow-ups 4.9% vs 3.0% without (+63%). **48% of decision-makers appreciate** follow-ups, 25% find them annoying. Unsubscribes rise **after the 3rd follow-up**. |
| **Belkins** 2025 study (16.5M, 2024) | Single-email sequences had the highest per-email reply rate (8.4%). **4+ emails more than tripled** unsubscribe and spam complaints. Recommends 1 email + 1 follow-up. |
| **Belkins** 2026 study (7.5M, 2025) | Follow-ups produced **58.6% of all replies** and step 3 drove the most meetings. Recommends 3-5 steps, with diminishing returns after 5. After 3 unanswered emails, switch channel (LinkedIn). |
| **Instantly** 2026 | 58% of replies come from email 1 and 42% from follow-ups. Space emails 3-7 days apart. |
| **Yesware** | If email 1 gets no reply, there's a 21% chance of a reply to email 2. 91% of opens happen within a day. |
| **Whali** (students) | 1 email: 1.3% tracked, 2 emails: 2.1% (**+60%**), 3 emails: no measurable gain. Caps at 2-3 emails, follow-ups on **day 3 and day 7**. |
| **Dalton 3B7** (Duke career blog) | Email one contact per company. **No reply in 3 business days → contact someone else at that company. No reply by 7 business days → follow up with the original contact.** Stop once you find a "booster". |
| **Stanford Alumni** | Wait about a week, send one follow-up (shrink the ask to 15 minutes or ask for someone else to talk to), then move on. |
| **Dartmouth** | No reply in 5-7 days → a short "did this reach you?" note. Thank-you within 24 hours after a call. |

**Conclusion:**
- **Two follow-ups maximum** (three emails total) per person. Recruiters get **one** follow-up.
- **Follow-up #1** at **+5 business days** (7 calendar days). This splits Dalton's 7 and Stanford's "a week" with the vendors' 3-day guidance; students emailing strangers should lean polite. Reply in the **same thread** with ≤50 words. Restate the ask, make it smaller ("even 10 minutes"), and add one new piece of information. No guilt ("just bumping this", "following up again").
- **Follow-up #2** at **+7 business days** after #1 (about 2.5 weeks after the original), ≤40 words. Close the loop gracefully: "If now's not a good time, totally understand — is there someone else on the team you'd suggest?" Stanford and Belkins both say to switch target or channel after this.
- **Stop:** after follow-up #2, after any reply (even a no, which gets a thank-you), when the application is rejected, or when the recruiter says to use the portal. Meanwhile, per 3B7, contact a *second* person at the company at day 3, rather than spamming the first.
- **Recruiters after applying:** first email 1-5 days after applying (SentinelOne: not the minute you apply). One follow-up after about 7-10 business days. The University of Arizona career center says to wait 2 weeks before a status check.

## 6. Timing

| Source | Finding |
|---|---|
| **Belkins** 2026 (7.5M, 2025) | **Wed/Thu 0.48%** were best on weekdays. **8am-12pm local 0.54%** was the best slot. Evenings 0.40% were the worst, reversing older studies. Friday was weaker. |
| **Instantly** 2026 | **Tue/Wed** peak replies, Wednesday best. Friday has the most auto-replies. |
| **Whali** (students, open rates) | **Tue/Wed** best opens (78-79%). Thu/Fri worst (about 69%). |
| **Hunter** 2025 survey | Decision-makers are "indifferent to when you email". Timing is a minor lever. |
| **Yesware** | 91% of opens happen within 24 hours, so the send hour mostly controls where the email lands in the inbox. |

**Conclusion:** Schedule sends for **Tuesday-Thursday, 7:30-10:30am in the recipient's time zone**. Avoid Friday afternoon, weekends, and US holidays. It's a small effect, so never delay an email more than about 3 days to hit a window.

## 7. Readability

- **Grade level:** Boomerang found **3rd-grade Flesch-Kincaid was best** (53% vs 39% for college level, a 36% lift), and 17% higher than high-school level. Lavender reportedly found 3rd-5th grade got 67% more replies (secondary source; couldn't find the primary). Target: **grade 5-8**. Professionals expect a competent student, so grade 3 can read as childish, but no sentence over 20 words and no jargon stacks.
- **Questions:** Boomerang found 1-3 questions beat zero by 50%. Reply.io found no-question sales emails did better. Use **exactly 1 question**: the CTA.
- **Paragraphs:** 3-4 sentences total (Gong) in **2-4 short paragraphs of 1-2 sentences**, separated by blank lines. No bullets in a cold email.
- **Mobile:** with a short subject plus the first line visible in the inbox preview, the **first 90 characters** must carry the hook. Quantic says to keep emails short for mobile readers.
- **Tone:** Boomerang found slightly warm emails (sentiment about 0.35) beat neutral by about 15%, and gushing emails lost the gain. Be warm, not effusive.
- **Links and attachments:** Hunter found no significant penalty for images or links, but **tracking lowers replies**. Deliverability folklore says multiple links and attachments from a new sender raise spam risk. Use 0 links in the body, 1 in the signature at most, and no attachment except to recruiters.

## 8. What hurts replies

| Pattern | Evidence |
|---|---|
| Pitching or listing your qualifications | Gong: pitching cuts replies by up to 57%. Dalton: the email is about them. |
| Long self-intro ("My name is X and I am a junior at Y majoring in Z with a minor in…") | Length data above. Dalton: brief. Put the school in the subject or one clause instead. |
| "I hope this email finds you well" / "I hope you're doing well" | No rigorous study isolates it (none found). Wastes the preview text, a near-universal tell of a template, and called out by Lavender-style coaching. Ban it. |
| Generic flattery ("I'm so impressed by [Company]'s innovative culture") | Lavender via Something Inc.: generic compliments and scraped facts are the clearest AI tells and add nothing. |
| Multiple asks (call + referral + résumé review + "any advice") | Gong: 3-4 sentences, one CTA. Gong: interest CTAs beat stacked or specific asks in cold email. |
| Asking a stranger for a job or referral in email #1 | Stanford, Dalton, career centers. |
| AI-sounding phrasing | 80% of hiring managers view AI-generated application materials negatively (CV Genius 2024, n=625). 33.5% say they can spot AI in under 20 seconds and 19.6% would reject over it (TopResume May 2025, n=600). 73% claim they can identify AI by impersonal language and overly polished formatting (HR Review). |
| Numbers or questions in the subject; long subjects | Gong, Lavender, Boomerang, Belkins. |
| 4+ emails to one person | Belkins: unsubscribe and spam complaints more than triple. Hunter: unsubscribes rise after the 3rd follow-up. |
| Tracking pixels | Hunter: tracked campaigns have lower reply rates. |

**AI tells to ban** (from Lavender coaching, hiring-manager surveys, and common LLM patterns): "I hope this finds you well", "I came across your profile", "I am reaching out to", "I wanted to reach out", "I am passionate about", "I'm excited to", "delve", "leverage", "synergy", "innovative", "cutting-edge", "I'd love to pick your brain", "esteemed", "I truly admire", "resonated with me", "aligns perfectly", "fast-paced environment", "at the intersection of", "Thank you for your time and consideration", "I look forward to hearing from you", "just following up", "circling back", "bumping this to the top of your inbox", em dashes used as dramatic pauses, three-item lists of adjectives, and "not only X but also Y".

## 9. Model emails

Word counts are for the body only, excluding greeting and signature.

**A. Recruiter, 2 days after applying** (62 words)
> **Subject:** Summer analyst applicant, Chicago
>
> Hi Priya,
>
> I applied Tuesday for the Summer 2027 Analyst role in Chicago (req 48213) and wanted to put a name to the application.
>
> I'm a junior at Iowa State in finance. Last summer I built the cash-forecast model our 40-person credit union still uses each week, which seems close to what the posting describes.
>
> Is there anything else that would help your review?
>
> Thanks,
> Maya Chen
> linkedin.com/in/mayachen · résumé attached

**B. Alum, coffee chat** (57 words)
> **Subject:** Fellow Hokie, quick question
>
> Hi Daniel,
>
> I'm a Virginia Tech sophomore in CS, and I saw you went from our ACM chapter to Stripe's payments infra team.
>
> I'm trying to understand what backend work looks like in a first job, and your path is exactly the one I'm weighing.
>
> Would you be open to a 15-minute call in the next couple of weeks?
>
> Thanks so much,
> Jordan

**C. Hiring manager** (63 words)
> **Subject:** Your team's churn dashboard post
>
> Hi Ms. Alvarez,
>
> Your LinkedIn post on rebuilding the churn dashboard in dbt stuck with me. I did a smaller version for our campus food pantry, cutting a weekly report from 3 hours to 10 minutes.
>
> I applied for the Data Analyst I role on your team last week.
>
> Would you be open to a 10-minute chat about what the team is focused on this year?
>
> Thank you,
> Sam Patel, Rutgers '26

**D. Follow-up #1** (same thread, +5 business days) (30 words)
> Hi Daniel,
>
> Floating this back up in case it got buried. Even 10 minutes would help. I'm especially curious how you picked infra over product teams.
>
> Totally understand if things are busy.
>
> Thanks,
> Jordan

**E. Follow-up #2** (same thread, +7 business days after #1) (31 words)
> Hi Daniel,
>
> Last note from me, I promise. If now isn't a good time, no problem at all. Is there a newer engineer on your team you'd suggest I reach out to instead?
>
> Thanks either way,
> Jordan

---

## Rules for the AI email writer

### Hard limits (fail the draft if violated)
1. **First email body: 45-100 words**, target 60-85. Count excludes greeting, sign-off, and signature.
2. **Follow-up #1: ≤50 words. Follow-up #2: ≤40 words.**
3. **Sentences: 3-6** in a first email (target 4), **2-4** in a follow-up. No sentence over 25 words. Average ≤15.
4. **Paragraphs: 2-4**, each 1-2 sentences, separated by blank lines. No bullet points, bold, or headers in the body.
5. **Exactly one question mark** in the body, and it is the CTA, in the last paragraph. Zero in the subject.
6. **Subject: 2-6 words, ≤40 characters, sentence case**, no "?", no "!", no emoji, no "Re:"/"Fwd:" faking. Digits only for a req ID or class year.
7. **Reading level: Flesch-Kincaid grade ≤8** (target 5-7).
8. **Links in body: 0.** At most one link (LinkedIn or portfolio) in the signature.
9. **Attachments:** none, except a résumé for a recruiter email after applying, where it's optional.
10. **"I" may start at most one sentence.** At least one sentence must be about the recipient (their work, team, path, or post).

### Required elements (in this order)
1. **Greeting:** "Hi {FirstName}," (use "Hi Mr./Ms. {Last}," only if the user picks formal; finance/law hiring managers may get the formal default).
2. **Line 1 = the connection** (why this person): shared school, referrer name, or one specific, verifiable detail about their work. Never generic company praise. If no real hook is available, use the school or role and keep it plain. Never invent one.
3. **Who you are, in ≤1 clause:** year + school + major (e.g. "I'm a junior at Iowa State in finance"). The school can move to the subject for alumni.
4. **One proof point** (recruiter and hiring manager only): a concrete project or result with a number, tied to the posting or team. At most one.
5. **Application mention:** recruiter and hiring manager: **required**, with exact role title, plus location/team and req ID if known ("I applied Tuesday for…"). Alum and peer: optional, ≤1 clause, never the ask.
6. **One CTA as an interest question:** "Would you be open to a {10|15}-minute call…?" or, for recruiters, "Is there anything else that would help your review?" Never offer specific times in email #1. Offer 2-3 time windows only after they say yes.
7. **Grateful close:** "Thanks," / "Thank you," / "Thanks so much," (Boomerang: thank-you closings 62% vs 46%). Then full name, plus school and class year if not in the body.

### Banned (reject or rewrite if present, case-insensitive)
- Openers: "I hope this email finds you well", "I hope you are doing well", "I hope you're having a great week", "My name is", "I am writing to", "I am reaching out", "I wanted to reach out", "I came across your profile", "I know you're busy", "Sorry to bother you".
- Filler and AI tells: "passionate", "excited to", "thrilled", "delve", "leverage", "synergy", "innovative", "cutting-edge", "dynamic", "fast-paced", "esteemed", "truly admire", "resonates", "aligns perfectly", "at the intersection of", "unique opportunity", "pick your brain", "valuable insights", "any advice you could offer", "not only… but also", "I believe I would be a great fit", "I am confident that".
- Closers: "I look forward to hearing from you", "Thank you for your time and consideration", "Please let me know if you have any questions", "Best regards" after a thank-you line (redundant).
- Follow-up phrasing: "just following up", "circling back", "bumping this", "per my last email", "I haven't heard back", "gentle reminder".
- Asks in a first email to an alum or peer: "job", "position available", "refer me", "referral", "hire". Recruiter and hiring-manager emails may name the role they applied to.
- More than one em dash in the body, three-adjective lists, exclamation points (max 0), emoji.
- Generic company compliments that could apply to any company ("{Company}'s amazing culture", "recent growth").

### Per-recipient variants
| Field | Recruiter | Hiring manager | Alum | Peer (engineer/analyst) |
|---|---|---|---|---|
| Subject pattern | "{Role} applicant, {location/school}" | "{Their team/project/post}" or "{Role} applicant, {school}" | "{School mascot/name} {year/major} question" | "{Shared thing}" or "{Their project}" question |
| Line 1 hook | Applied for {exact title} on {day} (+req ID) | Specific team work or post → your related proof point | Shared school (+club/major) + their path | Shared background or something they built |
| Proof point | Required (1, matched to posting) | Required (1, matched to team) | Omit or ≤1 clause | Omit or ≤1 clause |
| Mention application | Required | Required (1 sentence) | Optional (≤1 clause) | Optional (≤1 clause) |
| Ask | "Anything else that would help your review?" / "Happy to answer any questions about my background", optionally "Would a short call be useful?" | "Open to a 10-minute chat about the team's focus this year?" | "Open to a 15-minute call in the next couple of weeks?" | "Open to a 10-15 minute chat about what the work is like day to day?" |
| Résumé | May attach, or "happy to send" | "Happy to send my résumé" (no attachment) | No | No |
| Word target | 50-80 | 60-90 | 50-80 | 50-80 |
| Follow-ups | 1 max | 2 max | 2 max | 2 max |

**Industry modifiers**
- **Finance/consulting:** default to slightly more formal ("Hi Sarah," still fine, no slang). Always use the school in the subject for alumni. Mention the target group/office ("TMT coverage", "Chicago office"). Alumni chats are the normal path to a referral. Send early in the recruiting cycle.
- **Tech:** casual-professional. The proof point must be something built (repo, project, shipped feature) related to their product or stack. No flattery. One link to GitHub or a portfolio in the signature is allowed.
- **Other/government/large non-tech:** informational-interview framing. Recruiter emails are lower-yield, so prefer alumni.

### Follow-up schedule
| Step | When (business days) | Length | Content rules |
|---|---|---|---|
| Email 1 | Day 0, Tue-Thu 7:30-10:30am recipient time | 45-100 words | Rules above |
| (Parallel) | Day 3, no reply | — | Suggest a **second contact at the same company** (Dalton 3B7). Don't nudge contact #1 yet. |
| Follow-up #1 | Day 5 (≈1 week); recruiters day 7-10 | ≤50 words | Same thread ("Re:" original subject). Restate the ask smaller (10 minutes). Add **one new detail** (a specific question, an update, or a new project). No guilt words. |
| Follow-up #2 | Day 12 (≈7 business days after #1); not for recruiters | ≤40 words | Same thread. Give an out ("totally understand if busy") **plus** an alternative ask ("Is there someone else on the team you'd suggest?"). Signal it's the last note. |
| Stop | After #2, any reply, rejection, or "use the portal" | — | Never send a 4th email. Suggest a LinkedIn connect (no pitch) or a different contact instead. |
| On a reply | Within 24 hours | ≤60 words | Thank them, offer 2-3 specific time windows (now a specific CTA beats an interest one), and include your time zone. |
| After a call | Within 24 hours | ≤80 words | Thank them and cite one specific thing they said. Referral ask allowed here if the call went well and you've applied. |

### Quick self-check the writer should run before returning
- [ ] Body word count in range for the email type
- [ ] 1 question mark, located in the final paragraph
- [ ] Subject 2-6 words, ≤40 chars, no ?/!
- [ ] First sentence references the recipient or the shared connection, not "I am…"
- [ ] Recruiter/HM: exact role title present. Alum/peer: no job/referral ask
- [ ] No banned phrase. FK grade ≤8. 0 body links
- [ ] Ends with a thank-you sign-off

---

## Sources
- Boomerang, 7 tips for getting more responses (40M emails, 2016): https://blog.boomerangapp.com/2016/02/7-tips-for-getting-more-responses-to-your-emails-with-data/
- Boomerang sign-off study (350k threads), via Inc.: https://www.inc.com/jessica-stillman/your-emails-are-36-percent-more-likely-to-get-a-reply-if-you-close-them-this-way.html
- Hunter, cold email word count (34M, 2022-24): https://hunter.io/blog/cold-email-word-count
- Hunter, State of Cold Email 2025 (11M, 2024): https://hunter.io/the-state-of-cold-email-2025
- Gong Labs, Does cold email still work (28M, 2025): https://www.gong.io/resources/labs/does-cold-email-even-work-any-more-heres-what-the-data-says/
- Gong Labs, interest-based CTA (304k): https://www.gong.io/resources/labs/this-surprising-cold-email-cta-will-help-you-book-a-lot-more-meetings/
- Lavender, cold email benchmark (231,818, Feb 2026): https://lavender.ai/blog/the-cold-email-benchmark-report
- Lavender, subject lines: https://lavender.ai/blog/subject-lines-matter-more-than-you-think-stop-overthinking-them
- Something Inc., on Lavender data and AI tells: https://somethinginc.com/blog/cold-email-sounds-like-ai-lavender-data/
- Belkins, follow-up statistics (2025 data, 7.5M): https://belkins.io/blog/sales-follow-up-statistics
- Belkins, response rates 2026 (timing, seniority): https://belkins.io/blog/cold-email-response-rates
- Belkins, subject line statistics (5.5M, 2024): https://belkins.io/blog/b2b-cold-email-subject-line-statistics
- Instantly, 2026 benchmark report: https://instantly.ai/cold-email-benchmark-report-2026 ; best time to send: https://instantly.ai/blog/best-time-to-send-cold-email/
- Woodpecker, follow-up statistics: https://woodpecker.co/blog/follow-up-statistics/
- Yesware, follow-up statistics: https://yesware.com/blog/sales-follow-up-statistics
- Reply.io, subject line research: https://reply.io/reply-research-subject-lines/
- Whali, student cold email study (6,337 emails, 2025-26): https://whali.com/blog/cold-email-data-study-students-2026
- Steve Dalton 2HJS summaries: IE infographic https://static.ie.edu/CMC/T%26C%20UNI/2hour-job-search-Steve-Dalton-infographic.html ; Duke 3B7 https://careerhub.students.duke.edu/blog/2023/09/07/following-up-is-the-most-critical-part-of-your-outreach/ ; NIH 6-point email https://www.training.nih.gov/oite-careers-blog/6-point-networking-email
- Stanford Alumni, cold-contacting an alum: https://alumni.stanford.edu/career-connections/cold-contacting-an-alum-here-s-what-you-should-do
- Yale SOM, recruiter email templates: https://cdo.som.yale.edu/blog/2025/08/26/10-email-templates-for-every-situation-youll-face-with-a-recruiter/
- Daily Pennsylvanian, cold emailing guide: https://thedp.com/article/2022/04/dp-guide-to-cold-emailing-recruiters-row
- Dartmouth networking templates: https://careerdesign.dartmouth.edu/resources/networking-outreach-templates-sample-questions/ ; BYU networking emails; Tufts; St. Thomas; Hamilton (subject-line examples)
- SentinelOne recruiting, reaching out after applying: https://www.sentinelone.com/careers/blog/from-application-to-conversation-the-right-way-to-reach-out-to-a-recruiter/
- University of Arizona, I applied, now what: https://career.arizona.edu/resources/i-applied-now-what/
- TopResume AI-in-hiring survey (May 2025): https://topresume.com/career-advice/ai-in-hiring-survey
- Lever referral hire rate, via SHRM: https://shrm.org/topics-tools/news/talent-acquisition/lever-study-shows-1-100-candidates-hired ; Glassdoor interview sources: https://www.glassdoor.com/research/interview-sources/
- Blind threads (recruiter and candidate anecdotes): https://www.teamblind.com/post/thoughts-on-cold-emailing-recruiter-hiring-manager-qy1fw4fp
- Offerloop, IB cold email benchmarks (vendor, unverified): https://www.offerloop.ai/blog/cold-email-investment-banking

**Gaps:** Reddit (r/FinancialCareers, r/csMajors) couldn't be fetched directly, so student experience comes from Blind/HN and vendor summaries. No study isolates "I hope this finds you well" or lowercase subjects for job seekers. The Dalton book itself wasn't accessed; its rules come from university summaries of the book and his slides.
