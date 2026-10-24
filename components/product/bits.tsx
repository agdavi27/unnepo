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

export function StatusPill({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-cream">{children}</p>;
}
