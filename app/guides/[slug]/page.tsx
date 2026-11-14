import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideBody, renderInline } from "@/components/guides/guide-body";
import { GuideCta } from "@/components/guides/guide-cta";
import { SERIF } from "@/components/guides/styles";
import { formatGuideDate, getGuide, GUIDES_AUTHOR, guideUrl, isPublished, publishedGuides, relatedGuides, SITE_URL } from "@/lib/guides";

// Articles published at build are prerendered; later ones render on first visit once their date arrives
// (dynamicParams stays on), and everything is re-checked hourly.
export const revalidate = 3600;

export function generateStaticParams() {
  return publishedGuides(Date.now(), false).map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: PageProps<"/guides/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return { title: "Guide not found · Unnepo", robots: { index: false } };
  return {
    title: `${guide.title} · Unnepo`,
    description: guide.description,
    keywords: [guide.keyword, guide.category, "college students", "internships"],
    authors: [{ name: GUIDES_AUTHOR.name, url: `${SITE_URL}/story` }],
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: {
      type: "article",
      title: guide.title,
      description: guide.description,
      url: `/guides/${guide.slug}`,
      siteName: "Unnepo",
      publishedTime: guide.publishAt,
      modifiedTime: guide.updated ?? guide.publishAt,
      authors: [GUIDES_AUTHOR.name],
      section: guide.category,
    },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description },
  };
}

export default async function GuidePage({ params }: PageProps<"/guides/[slug]">) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();
  const related = relatedGuides(guide);
  const toc = guide.blocks.flatMap((block) => (block.type === "h2" ? [block] : []));
  const scheduled = !isPublished(guide);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: guide.title,
      description: guide.description,
      keywords: guide.keyword,
      articleSection: guide.category,
      datePublished: guide.publishAt,
      dateModified: guide.updated ?? guide.publishAt,
      mainEntityOfPage: guideUrl(guide.slug),
      url: guideUrl(guide.slug),
      image: `${guideUrl(guide.slug)}/opengraph-image`,
      author: { "@type": "Person", name: GUIDES_AUTHOR.name, jobTitle: GUIDES_AUTHOR.role, url: `${SITE_URL}/story` },
      publisher: { "@type": "Organization", name: "Unnepo", url: SITE_URL, logo: { "@type": "ImageObject", url: `${SITE_URL}/apple-icon.png` } },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Unnepo", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
        { "@type": "ListItem", position: 3, name: guide.title, item: guideUrl(guide.slug) },
      ],
    },
    ...(guide.faq.length
      ? [{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: guide.faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })),
      }]
      : []),
  ];

  return (
    <main className="mx-auto max-w-[760px] px-5 pb-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {scheduled && <p className="m-0 mt-2 rounded bg-[#F3E2B3] px-3 py-2 text-[13px] text-[#6B4E00]">Scheduled for {formatGuideDate(guide.publishAt)}. Only visible in development until then.</p>}

      <nav aria-label="Breadcrumb" className="mt-6 text-[13px] text-[#8A847A]">
        <Link href="/guides" className="hover:text-[#1B1B1F]">Guides</Link> <span aria-hidden>›</span> <span>{guide.category}</span>
      </nav>

      <article>
        <h1 className={`mb-0 mt-3 ${SERIF} text-[clamp(32px,5vw,50px)] font-normal leading-[1.08] tracking-[-1px]`}>{guide.title}</h1>
        <p className={`mb-0 mt-4 ${SERIF} text-[clamp(18px,2.2vw,21px)] italic leading-[1.5] text-[#4A463F]`}>{guide.description}</p>

        <div className="mt-6 flex items-center gap-3 border-y border-[#E2DDD4] py-3">
          <Image src="/founders/drew.jpg" alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover object-[50%_30%]" />
          <div className="text-[13px] leading-snug text-[#6B665E]">
            <span className="font-semibold text-[#1B1B1F]">By {GUIDES_AUTHOR.name}</span>, {GUIDES_AUTHOR.role.charAt(0).toLowerCase() + GUIDES_AUTHOR.role.slice(1)}
            <br />
            <time dateTime={guide.publishAt}>{formatGuideDate(guide.publishAt)}</time>
            {guide.updated && <> · Updated <time dateTime={guide.updated}>{formatGuideDate(guide.updated)}</time></>}
            {" · "}{guide.readMinutes} min read
          </div>
        </div>

        {toc.length > 2 && (
          <nav aria-label="On this page" className="mt-7 rounded-[6px] border border-[#E2DDD4] bg-white/60 px-5 py-4">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A847A]">On this page</p>
            <ol className="m-0 mt-2 flex list-decimal flex-col gap-1 pl-5 text-[15px] marker:text-[#8A847A]">
              {toc.map((heading) => <li key={heading.id}><a href={`#${heading.id}`} className="text-[#2A2824] hover:text-[#2F5FC4]">{renderInline(heading.text.replace(/^\d+\.\s+/, ""))}</a></li>)}
            </ol>
          </nav>
        )}

        <div className="mt-8">
          <GuideBody blocks={guide.blocks} slug={guide.slug} live={new Set(publishedGuides().map((item) => item.slug))} />
        </div>

        <GuideCta slug={guide.slug} variant="end" />

        <aside className="mt-10 flex gap-4 border-t border-[#E2DDD4] pt-6">
          <Image src="/founders/drew.jpg" alt="Drew Davis" width={64} height={64} className="h-16 w-16 shrink-0 rounded-full object-cover object-[50%_30%]" />
          <div className="text-[15px] leading-relaxed text-[#4A463F]">
            <p className="m-0 font-semibold text-[#1B1B1F]">About the author</p>
            <p className="m-0 mt-1">
              Drew Davis is a student at Colby College going through the internship search himself. He built Unnepo to take the busywork out of applying, so these guides mention it where it helps. Everything here works with or without it. <Link href="/story" className="text-[#2F5FC4] underline underline-offset-[3px]">Read his story</Link>.
            </p>
          </div>
        </aside>
      </article>

      {related.length > 0 && (
        <section aria-label="Keep reading" className="mt-12">
          <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#3D6FD1]">Keep reading</h2>
          <ul className="m-0 mt-3 flex list-none flex-col p-0">
            {related.map((item) => (
              <li key={item.slug} className="border-t border-[#E2DDD4] py-4">
                <Link href={`/guides/${item.slug}`} className="text-[18px] font-bold leading-snug text-[#1B1B1F] hover:text-[#2F5FC4]">{item.title}</Link>
                <p className={`m-0 mt-1 ${SERIF} text-[16px] leading-[1.55] text-[#6B665E]`}>{item.description}</p>
              </li>
            ))}
          </ul>
          <Link href="/guides" className="mt-2 inline-block text-[15px] font-semibold text-[#2F5FC4] hover:underline">All guides →</Link>
        </section>
      )}
    </main>
  );
}
