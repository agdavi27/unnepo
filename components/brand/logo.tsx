import Link from "next/link";

export function VersionBadge() {
  return <span className="ml-1.5 inline-flex -translate-y-0.5 items-center rounded-md border border-line px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-[0.08em] text-muted">V1</span>;
}

/** The wordmark with the V1 badge. Pass href to make it a link. */
export function Logo({ href, className = "text-2xl font-semibold tracking-tight" }: { href?: string; className?: string }) {
  const mark = <>unnepo.<VersionBadge /></>;
  return href ? <Link href={href} className={`${className} inline-flex items-center`}>{mark}</Link> : <span className={`${className} inline-flex items-center`}>{mark}</span>;
}
