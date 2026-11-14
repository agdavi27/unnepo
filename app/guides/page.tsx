import type { Metadata } from "next";
import Link from "next/link";
import { SERIF } from "@/components/guides/styles";
import { formatGuideDate, GUIDES_AUTHOR, isPublished, publishedGuides, SITE_URL } from "@/lib/guides";

// Re-checked every hour, so each day's article appears on its own.
export const revalidate = 3600;

const TITLE = "Job and internship guides for college students";
const DESCRIPTION = "Free, practical guides for students applying to internships and first jobs: resumes, cover letters, cold emails, following up, interviews and getting replies.";

export const metadata: Metadata = {
  title: `${TITLE} · Unnepo`,
  description: DESCRIPTION,
  alternates: { canonical: "/guides", types: { "application/rss+xml": "/guides/rss.xml" } },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: "/guides", siteName: "Unnepo" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function GuidesIndex() {
  const guides = publishedGuides();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Unnepo student career guides",
    description: DESCRIPTION,
    url: `${SITE_URL}/guides`,
    publisher: { "@type": "Organization", name: "Unnepo", url: SITE_URL },
    blogPost: guides.filter((guide) => isPublished(guide)).map((guide) => ({
      "@type": "BlogPosting",
      headline: guide.title,
      url: `${SITE_URL}/guides/${guide.slug}`,
      datePublished: guide.publishAt,
      author: { "@type": "Person", name: GUIDES_AUTHOR.name },
    })),
  };

  return (
    <main className="mx-auto max-w-[760px] px-5 pb-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <p className="m-0 mt-6 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#3D6FD1]">Guides</p>
      <h1 className={`mb-0 mt-3 ${SERIF} text-[clamp(34px,5.4vw,52px)] font-normal leading-[1.05] tracking-[-1px]`}>{TITLE}</h1>
      <p className={`mb-0 mt-4 max-w-[620px] ${SERIF} text-[19px] italic leading-[1.5] text-[#4A463F]`}>
        Straight answers on resumes, cold emails, following up and getting hired, written by a student who is in the same job search you are.
      </p>

      <ol className="m-0 mt-10 flex list-none flex-col p-0">
        {guides.map((guide) => (
          <li key={guide.slug} className="border-t border-[#E2DDD4] py-6">
            <div className="flex flex-wrap items-center gap-x-2 text-[12px] uppercase tracking-[0.14em] text-[#8A847A]">
              <span className="font-semibold text-[#3D6FD1]">{guide.category}</span>
              <span aria-hidden>·</span>
              <time dateTime={guide.publishAt}>{formatGuideDate(guide.publishAt)}</time>
              {!isPublished(guide) && <span className="rounded bg-[#F3E2B3] px-1.5 py-0.5 text-[10px] font-semibold text-[#6B4E00]">Scheduled · dev only</span>}
            </div>
            <h2 className="m-0 mt-2 text-[22px] font-bold leading-snug tracking-[-0.3px]">
              <Link href={`/guides/${guide.slug}`} className="text-[#1B1B1F] hover:text-[#2F5FC4]">{guide.title}</Link>
            </h2>
            <p className={`m-0 mt-2 ${SERIF} text-[17px] leading-[1.6] text-[#4A463F]`}>{guide.description}</p>
            <p className="m-0 mt-2 text-[13px] text-[#8A847A]">{guide.readMinutes} min read</p>
          </li>
        ))}
      </ol>
      {guides.length === 0 && <p className="text-[#6B665E]">The first guide is on its way.</p>}
    </main>
  );
}
