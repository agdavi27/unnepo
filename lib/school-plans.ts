import { isSchoolEmail, normalizeEmail } from "@/lib/schools";

/**
 * Schools that pay for Unnepo for their students. A school plan is set up by hand when a school signs, so
 * the list lives in the UNNEPO_SCHOOL_PLANS setting ("colby.edu=Colby College,bates.edu=Bates College").
 * The home page asks before sign-up whether the student's school is on it. Nothing typed in is stored.
 */

function schoolPlans(): Map<string, string> {
  const plans = new Map<string, string>();
  for (const entry of (process.env.UNNEPO_SCHOOL_PLANS ?? "").split(",")) {
    const [domain, name] = entry.split("=").map((part) => part?.trim() ?? "");
    if (domain) plans.set(domain.toLowerCase(), name || domain);
  }
  return plans;
}

/** "colby.edu" reads as "Colby"; good enough to say back to the student. */
const nameFromDomain = (domain: string) => {
  const base = domain.replace(/\.(edu|ac)(\.[a-z]{2})?$/, "").split(".").pop() ?? domain;
  return base.length <= 4 ? base.toUpperCase() : base.charAt(0).toUpperCase() + base.slice(1);
};

export type SchoolCheck =
  | { status: "not_school"; message: string }
  | { status: "covered" | "not_covered"; school: string };

/** Whether a school email's school has a plan. Students at schools without one can still start free. */
export function checkSchool(email: string): SchoolCheck {
  const domain = normalizeEmail(email).split("@")[1] ?? "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { status: "not_school", message: "Enter your school email, like you@colby.edu." };
  const plans = schoolPlans();
  // Students often have a department address (cs.colby.edu); the school's own domain is what counts.
  const match = [...plans.keys()].find((planned) => domain === planned || domain.endsWith(`.${planned}`));
  if (match) return { status: "covered", school: plans.get(match)! };
  if (!isSchoolEmail(email)) return { status: "not_school", message: "That doesn't look like a school email. Use your .edu address." };
  return { status: "not_covered", school: nameFromDomain(domain) };
}
