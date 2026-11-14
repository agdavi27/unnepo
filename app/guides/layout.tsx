import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/config";

/** The /guides shell: the same cream, editorial look as /story, with a light header and footer. */
export default function GuidesLayout({ children }: LayoutProps<"/guides">) {
  return (
    <div className="min-h-screen bg-[#F6F3EE] text-[#1B1B1F]">
      <header className="mx-auto flex max-w-[760px] items-center justify-between px-5 py-5">
        <Link href="/" className="text-lg font-bold tracking-[-0.5px] text-[#1B1B1F]">unnepo<span className="text-[#3D8BFF]">.</span></Link>
        <Link href="/guides" className="text-[11px] uppercase tracking-[0.18em] text-[#8A847A] hover:text-[#1B1B1F]">Student career guides</Link>
      </header>
      {children}
      <footer className="mx-auto max-w-[760px] border-t border-[#E2DDD4] px-5 py-7 text-[13px] text-[#8A847A]">
        <Link href="/" className="hover:text-[#1B1B1F]">Unnepo</Link> · <Link href="/guides" className="hover:text-[#1B1B1F]">Guides</Link> · <Link href="/story" className="hover:text-[#1B1B1F]">Our story</Link> · <Link href="/privacy" className="hover:text-[#1B1B1F]">Privacy</Link> · <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[#1B1B1F]">{CONTACT_EMAIL}</a>
      </footer>
    </div>
  );
}
