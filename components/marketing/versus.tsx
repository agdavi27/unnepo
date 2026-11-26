const PIXEL = "font-[family-name:var(--font-pixel)]";

/** Other AI job tools (auto-apply bots, chatbots, resume builders) against Unnepo, one short line each. */
const ROWS: Array<[string, string]> = [
  ["Hundreds of applications, almost no replies", "Fewer applications, real replies"],
  ["Stuck at sign-in pages and robot checks", "Runs in your Chrome. You see every page"],
  ["Flagged as bot spam", "You press Submit on every one"],
  ["Robotic letters and canned answers", "Short, plain, written for this job"],
  ["Makes up experience on your resume", "Only rewords what's already there"],
  ["Nobody to email, no follow-up", "Emails the hiring team, then follows up"],
  ["Pay more to send more", "Autofill and tracking free, for good"],
];

function Mark({ good }: { good: boolean }) {
  return (
    <span aria-hidden className={`mt-[3px] flex h-4 w-4 flex-none items-center justify-center text-[10px] font-bold leading-none ${good ? "bg-[#4ADE80] text-[#0C0C0E]" : "border-2 border-[#3A3A42] text-[#F87171]"}`}>
      {good ? "✓" : "✕"}
    </span>
  );
}

/** Two columns that stay side by side down to phone width, since every line is short. */
export function Versus() {
  return (
    <div className="border-4 border-[#26262C] bg-[#0C0C0E]">
      <table className="w-full table-fixed border-collapse text-left text-[15px] leading-snug sm:text-[17px]">
        <caption className="sr-only">Other AI job tools compared with Unnepo</caption>
        <thead>
          <tr className="border-b-2 border-[#1F1F24]">
            <th scope="col" className={`w-1/2 p-3 sm:p-4 ${PIXEL} text-[9px] font-normal leading-relaxed text-[#9A9AA3] sm:text-[10px]`}>OTHER AI TOOLS</th>
            <th scope="col" className={`w-1/2 bg-[#3D8BFF]/[0.07] p-3 sm:p-4 ${PIXEL} text-[9px] font-normal leading-relaxed text-[#3D8BFF] sm:text-[10px]`}>UNNEPO</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([them, us]) => (
            <tr key={them} className="border-b-2 border-[#1F1F24] last:border-b-0">
              <td className="p-3 align-top text-[#9A9AA3] sm:p-4"><span className="flex gap-2.5"><Mark good={false} />{them}</span></td>
              <td className="bg-[#3D8BFF]/[0.07] p-3 align-top font-semibold text-[#F7F7F8] sm:p-4"><span className="flex gap-2.5"><Mark good />{us}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
