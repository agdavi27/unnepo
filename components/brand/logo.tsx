import Link from "next/link";
import { VERSION } from "@/lib/version";

export function VersionBadge() {
  return <span className="ml-1.5 inline-flex -translate-y-0.5 items-center rounded-md border border-line px-1.5 py-0.5 align-middle text-[10px] font-semibold tracking-[0.08em] text-muted">V{VERSION}</span>;
}

/** The wordmark with the version badge. Pass href to make it a link. */
export function Logo({ href, className = "text-2xl font-semibold tracking-tight" }: { href?: string; className?: string }) {
  // The dot is the brand blue.
  const mark = <>unnepo<span className="text-[#3D8BFF]">.</span><VersionBadge /></>;
  return href ? <Link href={href} className={`${className} inline-flex items-center`}>{mark}</Link> : <span className={`${className} inline-flex items-center`}>{mark}</span>;
}
