import Link from "next/link";
import type { ReactNode } from "react";
import type { Block } from "@/lib/guides";
import { GuideCta } from "@/components/guides/guide-cta";

export { SERIF } from "@/components/guides/styles";
import { SERIF } from "@/components/guides/styles";

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/**
 * Turns **bold**, *italic*, `code` and [links](/guides/x) into elements. Internal links use next/link. A link to a
 * guide that isn't live yet (not in `live`) shows as plain text until that guide's day comes, so nobody hits a 404.
 */
export function renderInline(text: string, live?: Set<string>): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold text-[#1B1B1F]">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-[#EFEAE1] px-1 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      const guideSlug = /^\/guides\/([a-z0-9-]+)/.exec(href)?.[1];
      if (guideSlug && live && !live.has(guideSlug)) return label;
      const className = "text-[#2F5FC4] underline decoration-[#2F5FC4]/40 underline-offset-[3px] hover:decoration-[#2F5FC4]";
      return href.startsWith("/")
        ? <Link key={index} href={href} className={className}>{label}</Link>
        : <a key={index} href={href} className={className} rel="noopener" target="_blank">{label}</a>;
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

/** An article's body. The FAQ section renders like any other, as h3 questions with paragraph answers. */
export function GuideBody({ blocks, slug, live }: { blocks: Block[]; slug: string; live: Set<string> }) {
  return (
    <div className={`flex flex-col gap-5 ${SERIF} text-[19px] leading-[1.7] text-[#2A2824]`}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "h2":
            return <h2 key={index} id={block.id} className="m-0 mt-6 scroll-mt-6 font-sans text-[24px] font-bold leading-tight tracking-[-0.4px] text-[#1B1B1F]">{renderInline(block.text, live)}</h2>;
          case "h3":
            return <h3 key={index} className="m-0 mt-2 font-sans text-[18px] font-bold leading-snug text-[#1B1B1F]">{renderInline(block.text, live)}</h3>;
          case "p":
            return <p key={index} className="m-0">{renderInline(block.text, live)}</p>;
          case "ul":
            return <ul key={index} className="m-0 flex list-disc flex-col gap-2 pl-6 marker:text-[#3D8BFF]">{block.items.map((item, i) => <li key={i}>{renderInline(item, live)}</li>)}</ul>;
          case "ol":
            return <ol key={index} className="m-0 flex list-decimal flex-col gap-2 pl-6 marker:font-sans marker:text-[15px] marker:font-semibold marker:text-[#3D6FD1]">{block.items.map((item, i) => <li key={i}>{renderInline(item, live)}</li>)}</ol>;
          case "quote":
            return (
              <blockquote key={index} className="m-0 rounded-[6px] border border-[#E2DDD4] border-l-[3px] border-l-[#3D8BFF] bg-white px-5 py-4 font-sans text-[16px] leading-[1.65] text-[#2A2824]">
                {block.lines.map((line, i) => line ? <p key={i} className="m-0">{renderInline(line, live)}</p> : <div key={i} className="h-3" aria-hidden />)}
              </blockquote>
            );
          case "cta":
            return <GuideCta key={index} slug={slug} variant="inline" />;
        }
      })}
    </div>
  );
}
