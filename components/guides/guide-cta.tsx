import { WaitlistButton } from "@/components/marketing/waitlist";
import { SERIF } from "@/components/guides/styles";

/**
 * The Unnepo plug in a guide: a short box mid-article (`[[cta]]`) and a bigger one at the end. Both open the
 * waitlist popup and record which article the signup came from.
 */
export function GuideCta({ slug, variant }: { slug: string; variant: "inline" | "end" }) {
  const source = `guide/${slug}`;
  if (variant === "inline") {
    return (
      <aside className="my-2 rounded-[6px] border border-[#D5E3FB] bg-[#EEF4FF] px-5 py-4 font-sans">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3D6FD1]">Shortcut</p>
        <p className="m-0 mt-1.5 text-[16px] leading-relaxed text-[#1B1B1F]">
          <strong>Unnepo</strong> is a free Chrome extension that fills out applications from your resume, finds a recruiter or team member at each company, drafts the email, and reminds you when to follow up.
        </p>
        <WaitlistButton source={source} label="Get early access →" className="mt-3 text-[15px] font-semibold text-[#2F5FC4] underline-offset-4 hover:underline" />
      </aside>
    );
  }
  return (
    <div className="mt-12 rounded-[6px] bg-[#1B1B1F] px-6 py-7 text-[#F6F3EE]">
      <p className={`m-0 ${SERIF} text-[26px] leading-[1.25]`}>Do the busywork in minutes, not evenings.</p>
      <p className="m-0 mt-3 max-w-[560px] text-[15px] leading-relaxed text-[#C9C4BA]">
        Unnepo fills in job applications from your resume and stops at Submit so you check it first. It tracks every job in one place, finds a person to email at each company, writes the note, and reminds you to follow up. Free for students.
      </p>
      <div className="mt-5">
        <WaitlistButton source={source} label="Join the waitlist" className="inline-flex min-h-[46px] items-center rounded-[8px] bg-[#3D8BFF] px-5 text-[15px] font-semibold text-white hover:bg-[#5A9DFF]" />
      </div>
    </div>
  );
}
