const PIXEL = "font-[family-name:var(--font-pixel)]";

/** The kinds of AI tool students reach for. Categories only, never brands. */
const TOOLS = ["Auto-apply bots", "ChatGPT-style writing", "Resume builders"] as const;

type Row = { topic: string; us: string; them: [string, string, string] };

/** Each row: what Unnepo does, then what each kind of tool in TOOLS does, in the same order. */
const ROWS: Row[] = [
  {
    topic: "Hundreds sent, few answered",
    us: "Fewer applications, each one to a job you picked, each followed by an email to a person. Built for replies, not a count.",
    them: ["Hundreds go out. Most bounce, get filtered or are never read, and you never hear back.", "A smoother letter still lands in the same pile.", "A prettier resume, same pile, same silence."],
  },
  {
    topic: "Stuck at sign-in",
    us: "Runs in your own Chrome. You sign in or make the account, Unnepo fills the rest, and you see every page.",
    them: ["Applications stall at account creation, email codes and robot checks, often without telling you.", "Can't touch the application form at all.", "Can't touch the application form at all."],
  },
  {
    topic: "Flagged as a bot",
    us: "You read the job and press Submit, one application at a time. Nothing to flag.",
    them: ["Near-identical applications, sent in bulk under your name, are exactly what recruiters screen out first.", "Recruiters spot the same stock phrases in letter after letter.", "Fancy columns and graphics can scramble in the software that reads resumes."],
  },
  {
    topic: "Answers to the questions",
    us: "\u201cWhy this company?\u201d answered from your resume and this posting. You read it before it goes.",
    them: ["Guessed or generic answers, sent before you ever see them.", "Fluent filler that could be about anyone.", "Not their job."],
  },
  {
    topic: "Sounds like a person",
    us: "Letters and emails are short and plain, written from what's actually on your resume for this one job.",
    them: ["The same letter on every job, or none at all.", "\u201cI am thrilled to apply\u2026\u201d Recruiters spot it in one line.", "Fill-in-the-blank templates."],
  },
  {
    topic: "Your resume",
    us: "Tailored to the job by rewording and reordering your own lines. It never adds experience, and your layout stays yours.",
    them: ["One resume, sent to every job.", "Happily invents skills, tools and numbers you'll be asked about in the interview.", "Retyped into their template, so your layout is gone."],
  },
  {
    topic: "A real person hears from you",
    us: "Unnepo finds 2 or 3 people on the hiring team and writes each a short, personal email about this job.",
    them: ["No. Your application joins the pile.", "Only if you find the person, their email and the nerve yourself.", "No."],
  },
  {
    topic: "Follow-up",
    us: "On Pro, your follow-up is written for you when it's time, and Outreach Season times two of them.",
    them: ["None. Send and forget.", "Only if you remember, and ask.", "None."],
  },
  {
    topic: "What it costs",
    us: "Autofill and tracking are free and unlimited, for good. Pro is $99 a semester, and you can cancel in two clicks.",
    them: ["Monthly plans that charge more to send more, for results that don't come.", "Another subscription, and you still do all the applying.", "Often a subscription just to download your own resume."],
  },
];

function Mark({ good }: { good: boolean }) {
  return (
    <span aria-hidden className={`mt-[3px] flex h-4 w-4 flex-none items-center justify-center text-[10px] font-bold leading-none ${good ? "bg-[#4ADE80] text-[#0C0C0E]" : "border-2 border-[#3A3A42] text-[#F87171]"}`}>
      {good ? "✓" : "✕"}
    </span>
  );
}

function Cell({ text, good }: { text: string; good: boolean }) {
  return (
    <span className="flex gap-2.5">
      <Mark good={good} />
      <span>{text}</span>
    </span>
  );
}

/**
 * Unnepo against the kinds of AI tool students use, row by row. A wide screen gets a table with Unnepo first;
 * anything narrower gets one card per row, so nothing scrolls sideways on a phone.
 */
export function Versus() {
  return (
    <>
      <div className="border-4 border-[#26262C] bg-[#0C0C0E] max-lg:hidden">
        <table className="w-full table-fixed border-collapse text-left text-sm leading-normal">
          <caption className="sr-only">Unnepo compared with auto-apply bots, ChatGPT-style writing and resume builders</caption>
          <thead>
            <tr className="border-b-2 border-[#1F1F24]">
              <td className="w-[15%] p-4" />
              <th scope="col" className={`w-[28%] border-x-2 border-[#3D8BFF] bg-[#3D8BFF]/[0.07] p-4 ${PIXEL} text-[10px] font-normal leading-relaxed text-[#3D8BFF]`}>UNNEPO</th>
              {TOOLS.map((tool) => (
                <th key={tool} scope="col" className={`p-4 ${PIXEL} text-[10px] font-normal uppercase leading-relaxed text-[#9A9AA3]`}>{tool}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.topic} className="border-b-2 border-[#1F1F24] last:border-b-0">
                <th scope="row" className="p-4 align-top text-[15px] font-semibold leading-snug text-[#F7F7F8]">{row.topic}</th>
                <td className="border-x-2 border-[#3D8BFF] bg-[#3D8BFF]/[0.07] p-4 align-top text-[#F7F7F8]"><Cell text={row.us} good /></td>
                {row.them.map((text, index) => (
                  <td key={TOOLS[index]} className="p-4 align-top text-[#9A9AA3]"><Cell text={text} good={false} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-4 p-0 lg:hidden">
        {ROWS.map((row) => (
          <li key={row.topic} className="flex flex-col border-4 border-[#26262C] bg-[#0C0C0E]">
            <h3 className="m-0 border-b-2 border-[#1F1F24] px-4 py-3 text-[17px] font-semibold leading-snug">{row.topic}</h3>
            <div className="flex flex-col gap-1.5 border-b-2 border-[#1F1F24] bg-[#3D8BFF]/[0.07] px-4 py-3.5 text-sm leading-normal text-[#F7F7F8]">
              <span className={`${PIXEL} text-[9px] leading-relaxed text-[#3D8BFF]`}>UNNEPO</span>
              <Cell text={row.us} good />
            </div>
            <dl className="m-0 flex flex-col gap-3 px-4 py-3.5 text-sm leading-normal text-[#9A9AA3]">
              {row.them.map((text, index) => (
                <div key={TOOLS[index]} className="flex flex-col gap-1">
                  <dt className={`${PIXEL} text-[9px] uppercase leading-relaxed text-[#B4B4BC]`}>{TOOLS[index]}</dt>
                  <dd className="m-0"><Cell text={text} good={false} /></dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
