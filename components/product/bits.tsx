"use client";

import { useState } from "react";
import { initials } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/catalog";

const COLORS = ["#d7c4a3", "#9eb0c6", "#e0b07a", "#b7c4a1", "#c5b0d4", "#a9c7c2", "#e7b2b2", "#c9c2ae"];

export function Avatar({ name, className = "h-9 w-9" }: { name: string; className?: string }) {
  const color = COLORS[name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % COLORS.length];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-black ${className}`} style={{ background: color }}>
      {initials(name)}
    </span>
  );
}

export function CompanyMark({ company }: { company: string }) {
  const letter = company.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-white px-1 text-[9px] font-black tracking-tight text-black">
      {letter}
    </span>
  );
}

const DOMAINS: Record<string, string> = {
  "the north face": "thenorthface.com",
  "arc'teryx": "arcteryx.com",
  patagonia: "patagonia.com",
  lululemon: "lululemon.com",
  "goldman sachs": "goldmansachs.com",
  hubspot: "hubspot.com",
};

export function companyDomain(company: string) {
  const key = company.toLowerCase().trim();
  if (DOMAINS[key]) return DOMAINS[key];
  const slug = key.replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  return `${slug || "example"}.com`;
}

export function CompanyLogo({ company, src, className = "h-11 w-11" }: { company: string; src?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`inline-flex items-center justify-center rounded-lg bg-white text-[11px] font-black text-black ${className}`}>
        {company.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}
      </span>
    );
  }
  const url = src || `https://www.google.com/s2/favicons?domain=${companyDomain(company)}&sz=128`;
  return <img src={url} alt="" className={`${className} rounded-lg bg-white object-contain p-1`} onError={() => setFailed(true)} />;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-cream">{children}</p>;
}
