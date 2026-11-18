/**
 * Resources: short, practical tips for the job search (the resume first), each topic with the guides that go
 * deeper, then every published guide by topic. The guides are the /guides articles; only published ones are passed in.
 */

export type GuideLink = { slug: string; title: string; description: string; category: string; readMinutes: number };

type Topic = { id: string; title: string; lead: string; tips: Array<[string, string]>; guides: string[] };

const TOPICS: Topic[] = [
  {
    id: "resume",
    title: "Make your resume stronger",
    lead: "Recruiters skim a resume in seconds, and software reads it first. Make both easy.",
    tips: [
      ["Write bullets as action, task, result", "\"Built a sign-up form that cut drop-off 20%\" beats \"Responsible for the website\". Start with a strong verb and end with a number when you have one."],
      ["Copy the posting's words", "If the job says \"SQL\" and \"stakeholders\", and you've done both, use those exact words. Applicant tracking systems match terms, not meaning."],
      ["Keep it to one page and one column", "No tables, text boxes, photos or icons: they scramble when software reads them. Save it as a PDF named First-Last-Resume.pdf."],
      ["Lead with what's strongest", "Still in school? Education goes first, with your GPA if it's 3.3 or higher. Put relevant classes and projects there when experience is thin."],
      ["Count everything that counts", "Campus jobs, clubs, research, class projects and side projects are experience. Write them the same way: what you did and what came of it."],
      ["Tailor the top third for each job", "You don't need a new resume per job. Reorder bullets and adjust the skills line so the first things read are the ones the posting asks for."],
    ],
    guides: ["tailor-resume-to-job-description", "how-applicant-tracking-systems-read-resumes", "resume-with-no-experience-college-student"],
  },
  {
    id: "applying",
    title: "Apply smarter",
    lead: "Timing and volume matter more than most students think.",
    tips: [
      ["Apply in the first few days", "Many postings get most of their applicants in the first week, and some close early. Check new postings often and apply fast."],
      ["Apply on the company's own site when you can", "Job boards are good for finding jobs; the company's careers page usually sends your application straight to the team."],
      ["Treat it as a numbers game, with aim", "Plenty of students send dozens of applications before an offer. Set a weekly goal and keep a steady pace instead of sending a burst and stopping."],
      ["Answer the short questions like a person", "\"Why us?\" is best answered with one specific thing about the company and one thing you've done that fits it. Two or three sentences is enough."],
      ["Watch for scams", "A real employer never asks you to pay, cash a check, or buy equipment first. Be careful with interviews held only over text."],
    ],
    guides: ["internship-recruiting-timeline", "how-many-internship-applications-should-i-send", "how-to-answer-short-answer-application-questions", "job-scams-targeting-college-students"],
  },
  {
    id: "reach",
    title: "Reach a real person",
    lead: "An application plus a short email to someone on the team gets far more replies than an application alone.",
    tips: [
      ["Email the recruiter or someone on the team", "The person who posted the job, a university recruiter, or someone in the role you want. Unnepo finds them after you apply."],
      ["Keep it to four sentences", "Who you are, the role you applied to, one specific reason you fit, and a small ask, like a 15-minute chat. Nothing they have to work to answer."],
      ["Start with alumni", "People from your school answer cold emails far more often. Search LinkedIn for your school plus the company."],
      ["Ask for a referral the right way", "After a conversation, not in the first message. Make it easy: send the job link and a two-line summary of why you fit."],
    ],
    guides: ["how-to-find-the-recruiter-for-a-job", "cold-email-for-internship-template", "how-to-email-alumni-for-career-advice", "how-to-ask-for-a-referral"],
  },
  {
    id: "follow",
    title: "Follow up without being annoying",
    lead: "Most replies come after the second email, not the first.",
    tips: [
      ["Wait about a week", "Five to seven business days after an email or application, send a short follow-up on the same thread."],
      ["Add something new", "A recent project, a question about the team, or a line on why you're still interested. Not just \"checking in\"."],
      ["Stop after two", "If two follow-ups get nothing, move on. It's rarely about you: inboxes are full."],
      ["Thank people within a day", "After any call or interview, send a thank-you email within 24 hours that mentions something you talked about."],
    ],
    guides: ["how-to-follow-up-on-a-job-application", "why-no-response-to-job-applications", "thank-you-email-after-interview"],
  },
  {
    id: "interview",
    title: "Get ready for interviews",
    lead: "Preparation is mostly stories: have five ready and you can answer almost anything.",
    tips: [
      ["Use STAR for every story", "Situation, task, action, result. Spend most of the time on what you did, and end with what happened."],
      ["Prepare five stories", "A challenge, a team conflict, a failure, a time you led, and something you're proud of. Most behavioral questions fit one of them."],
      ["Research one level deeper", "Read the job posting again, the company's recent news, and your interviewer's LinkedIn. Bring two questions only that research could produce."],
      ["Practice out loud", "Say your answers to a friend or record yourself. Answers that sound fine in your head usually run long."],
    ],
    guides: ["star-method-examples-for-students", "informational-interview-questions", "why-do-you-want-to-work-here-answer"],
  },
  {
    id: "profile",
    title: "Look good when they search you",
    lead: "Recruiters look you up after they read your resume.",
    tips: [
      ["Make your LinkedIn headline specific", "\"Economics student | Data analysis, SQL, Python\" beats \"Student\". Add a clear photo and your school."],
      ["Match your resume", "The same jobs, dates and titles as your resume. Differences make recruiters wonder which is right."],
      ["Use your career center", "Free resume reviews, mock interviews and alumni lists. Most students never go."],
    ],
    guides: ["linkedin-profile-tips-for-college-students", "how-to-use-your-college-career-center", "getting-hired-from-a-small-college"],
  },
];

const guideHref = (slug: string) => `/guides/${slug}`;

export function ResourcesView({ guides }: { guides: GuideLink[] }) {
  const bySlug = new Map(guides.map((guide) => [guide.slug, guide]));
  const categories = [...new Set(guides.map((guide) => guide.category))];
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">Resources</h1>
        <p className="m-0 mt-2 text-sm text-muted">Quick ways to improve your resume and your job search, with longer guides when you want more.</p>
      </div>

      <nav aria-label="Topics" className="flex flex-wrap gap-2">
        {TOPICS.map((topic) => (
          <a key={topic.id} href={`#${topic.id}`} className="rounded-full border border-[#26262C] px-3 py-1.5 text-[13px] text-[#B4B4BC] hover:border-[#3D8BFF] hover:text-white">{topic.title}</a>
        ))}
        {guides.length > 0 && <a href="#guides" className="rounded-full border border-[#26262C] px-3 py-1.5 text-[13px] text-[#B4B4BC] hover:border-[#3D8BFF] hover:text-white">All guides</a>}
      </nav>

      {TOPICS.map((topic) => {
        const deeper = topic.guides.map((slug) => bySlug.get(slug)).filter((guide): guide is GuideLink => Boolean(guide));
        return (
          <section key={topic.id} id={topic.id} aria-labelledby={`${topic.id}-title`} className="scroll-mt-24 rounded-2xl border border-[#1F1F24] bg-[#0C0C0E] p-4 sm:p-5">
            <h2 id={`${topic.id}-title`} className="m-0 text-xl font-semibold tracking-tight">{topic.title}</h2>
            <p className="m-0 mt-1 text-sm text-[#8B8B94]">{topic.lead}</p>
            <ol className="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2">
              {topic.tips.map(([title, body], index) => (
                <li key={title} className="flex gap-3 rounded-xl border border-[#17171B] bg-[#08080A] p-3.5">
                  <span aria-hidden className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-[#0C1424] font-mono text-[11px] font-semibold text-[#3D8BFF]">{index + 1}</span>
                  <div className="min-w-0">
                    <p className="m-0 font-medium">{title}</p>
                    <p className="m-0 mt-1 text-[13px] leading-relaxed text-[#9A9AA3]">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            {deeper.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5">
                <p className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[1.4px] text-[#8B8B94]">Go deeper</p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {deeper.map((guide) => (
                    <li key={guide.slug}>
                      <a href={guideHref(guide.slug)} target="_blank" rel="noopener" className="text-sm text-[#3D8BFF] underline-offset-4 hover:underline">{guide.title}</a>
                      <span className="text-xs text-[#8B8B94]"> · {guide.readMinutes} min read</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}

      {guides.length > 0 && (
        <section id="guides" aria-labelledby="guides-title" className="scroll-mt-24 rounded-2xl border border-[#1F1F24] bg-[#0C0C0E] p-4 sm:p-5">
          <h2 id="guides-title" className="m-0 text-xl font-semibold tracking-tight">All guides</h2>
          <p className="m-0 mt-1 text-sm text-[#8B8B94]">Free articles on every part of the search. A new one comes out most days.</p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {categories.map((category) => (
              <div key={category}>
                <h3 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[1.4px] text-[#8B8B94]">{category}</h3>
                <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {guides.filter((guide) => guide.category === category).map((guide) => (
                    <li key={guide.slug}>
                      <a href={guideHref(guide.slug)} target="_blank" rel="noopener" className="text-sm font-medium text-[#E4E4EA] underline-offset-4 hover:text-white hover:underline">{guide.title}</a>
                      <p className="m-0 mt-0.5 line-clamp-2 text-xs text-[#8B8B94]">{guide.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
