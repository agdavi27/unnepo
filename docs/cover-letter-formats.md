# Cover letter formats

What the research says, and what the extension's cover letter writer does with it (`lib/apply/cover-letter.ts`,
`LETTER_FORMATS`).

## What the evidence shows

- **Tailoring is the only thing measured to work.** ResumeGo's field experiment sent about 7,300 fictitious
  applications to real postings on ZipRecruiter, Glassdoor and Indeed. Callbacks: **16.4%** with a letter
  tailored to the job, **12.5%** with a generic letter, **10.7%** with no letter. Tailored beat generic by about
  31% relative (under 4 points absolute). The often-quoted "53%" is tailored vs. no letter.
  Source: https://www.resumego.net/research/cover-letters/
- **No study compares structures head to head.** Claims that one format "has the highest response rate" (most
  often Problem-Solution) come from career blogs citing recruiter-expectation surveys, not controlled tests.
  Treat them as practitioner consensus, not data.
- **Short wins.** Sources agree on three or four short paragraphs, roughly 250–300 words at most.
- Later "2024/2025/2026 ResumeGo" figures repeated online couldn't be traced to a primary source; don't cite them.

- **Readers skim.** Ladders' eye-tracking work (as widely cited) puts the first review of an application at a few
  seconds, so the role and the strongest match have to be in the first two sentences, and each paragraph's
  first sentence has to carry its point.
- **Generic and AI-sounding letters are penalized.** In vendor surveys of hiring managers (CV Genius, 625
  managers; TopResume, 600; Robert Walters), most say they can spot AI-written letters, mainly by impersonal,
  polished-but-empty phrasing and a lack of engagement with the posting; around a fifth say they'd reject one.
  In tech, AI help is accepted, but a generic letter that shows no familiarity with the job description isn't.
  These are self-reported and from firms with an interest, so read them as direction, not data.
- **Evidence over enthusiasm, the employer over the applicant.** Career-office and recruiter advice for
  entry-level applicants agrees: show research and a track record (projects, classes, clubs, part-time work)
  instead of saying you're passionate, and talk about what you'd do for them rather than what you want from them.
- **Do recruiters even read them?** Surveys disagree widely (Resume Genius: 83% read them often; ResumeBuilder
  2024: 26%). Where they are read, a strong one can tip a borderline candidate (Resume Genius: 49%).

These rules are in `LETTER_VOICE` ("What makes a letter work"), so the website's and the extension's letters
both follow them.

## What Unnepo does

Every format is built on the posting's own top two or three requirements, matched to the student's real
evidence, because tailoring is the measured lever. They differ only in what leads:

| Format | Key | Leads with | Good for |
| --- | --- | --- | --- |
| Match the job (default) | `match` | One requirement per paragraph, in the posting's order, each answered with evidence | Most postings; the closest to "tailored" in the study |
| Problem, then solution | `problem` | The need the role exists for (as the posting states it), then proof the student has met it | Business, operations, marketing, sales |
| Lead with a win | `achievement` | The student's strongest concrete result | Technical and data roles, students with a clear number |
| Short story | `story` | Two or three sentences of a real moment that shows the key skill | Mission-driven orgs, nonprofits, creative roles |

The voice rules (`LETTER_VOICE`) apply to all of them: only real facts, no clichés, under 250 words by default.

Note: on Free, letters are general (title and company only, no description). The study's lift is from
tailoring, so that's the part Pro is actually selling.
