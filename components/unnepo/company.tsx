"use client";

import { useState } from "react";
import type { Ats, JobApplication } from "@/lib/apply/types";

export const ATS_LABEL: Record<Ats, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", other: "Company site" };
const ATS_TINT: Record<Ats, string> = { greenhouse: "#3CB48A", lever: "#B4B4BC", ashby: "#9D8CF2", workday: "#F5A524", other: "#8B8B94" };

// Job boards and application systems: their domain isn't the company's, so no logo comes from it.
const NOT_COMPANY = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|linkedin\.com|joinhandshake\.com|indeed\.com|smartrecruiters\.com|icims\.com|jobvite\.com|bamboohr\.com|workable\.com|rippling\.com|breezy\.hr|recruitee\.com|wellfound\.com|ziprecruiter\.com|glassdoor\.com)$/i;

export function companySite(app: Pick<JobApplication, "companyDomain" | "jobUrl">) {
  if (app.companyDomain) return app.companyDomain.replace(/^www\./, "");
  try {
    const host = new URL(app.jobUrl).hostname.replace(/^www\./, "");
    if (NOT_COMPANY.test(host)) return null;
    return host.split(".").slice(-2).join(".");
  } catch {
    return null;
  }
}

export function CompanyLogo({ app, size = 36 }: { app: Pick<JobApplication, "company" | "companyDomain" | "jobUrl">; size?: number }) {
  const site = companySite(app);
  const [failed, setFailed] = useState(false);
  const initials = app.company.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
  const box = { width: size, height: size };
  if (site && !failed) {
    return (
      <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white" style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a small third-party favicon */}
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=64`}
          alt=""
          width={size * 0.62}
          height={size * 0.62}
          // Google answers unknown sites with a 16px globe: show initials instead.
          onLoad={(event) => { if (event.currentTarget.naturalWidth < 32) setFailed(true); }}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return <span className="flex shrink-0 items-center justify-center rounded-lg border border-line bg-card-2 text-xs font-semibold text-muted" style={box} aria-hidden>{initials}</span>;
}

/** A small monogram for the job system. The name shows beside it from tablet width, or always with `label`. */
export function AtsBadge({ ats, label = false }: { ats: Ats; label?: boolean }) {
  const tint = ATS_TINT[ats];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-faint" title={`Applied through ${ATS_LABEL[ats]}`}>
      <span className="flex h-4 w-4 items-center justify-center rounded-[4px] border text-[9px] font-bold leading-none" style={{ borderColor: `${tint}66`, color: tint, background: `${tint}14` }} aria-hidden>
        {ats === "other" ? (
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></svg>
        ) : ATS_LABEL[ats][0]}
      </span>
      <span className={label ? "" : "hidden sm:inline"}>{ATS_LABEL[ats]}</span>
    </span>
  );
}
