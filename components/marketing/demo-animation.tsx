import { DEMO_MEDIA } from "@/lib/install-link";

const PIXEL = "font-[family-name:var(--font-pixel)]";

/**
 * The demo animation (scripts/demo-animation.ts), on /get and, for phones, on the home page. An animated WebP: no video
 * player and no script. People who turn off motion get the still, and it loads lazily since on a phone it's below the
 * form. With DEMO_MEDIA.ready false, a still stand-in of the extension finishing a form.
 */
export function DemoAnimation({ className = "" }: { className?: string }) {
  if (DEMO_MEDIA.ready) {
    return (
      <picture className={className}>
        <source srcSet={DEMO_MEDIA.still} media="(prefers-reduced-motion: reduce)" />
        <img
          src={DEMO_MEDIA.webp}
          width={DEMO_MEDIA.width}
          height={DEMO_MEDIA.height}
          loading="lazy"
          decoding="async"
          alt="Unnepo's spider drops onto a job application, fills every field, attaches a resume and portfolio, writes a cover letter, lists people at the company to email and logs the job in a tracker"
          className="block h-auto w-full border-4 border-[#F7F7F8] bg-[#0C0C0E] shadow-[8px_8px_0_#3D8BFF]"
        />
      </picture>
    );
  }
  return (
    <div
      data-placeholder="demo-video"
      style={{ aspectRatio: `${DEMO_MEDIA.width} / ${DEMO_MEDIA.height}` }}
      className={`relative flex w-full flex-col justify-center gap-3 border-4 border-[#F7F7F8] bg-[#0C0C0E] p-[clamp(14px,4vw,26px)] shadow-[8px_8px_0_#3D8BFF] ${className}`}
    >
      {process.env.NODE_ENV !== "production" && (
        <span className="absolute right-2 top-2 rounded bg-[#F5A524] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-black">Placeholder: demo video</span>
      )}
      <p className={`m-0 ${PIXEL} text-[10px] leading-relaxed text-[#3D8BFF]`}>PRESS FILL</p>
      <ol className="m-0 flex list-none flex-col gap-[clamp(6px,1.6vw,11px)] border-2 border-[#26262C] bg-bg p-3 font-mono text-[clamp(12px,3.2vw,13px)] text-[#B4B4BC]">
        <li className="flex justify-between gap-4"><span>Filled your details</span><span className="text-[#4ADE80]">Done</span></li>
        <li className="flex justify-between gap-4"><span>Attached resume and letter</span><span className="text-[#4ADE80]">Done</span></li>
        <li className="flex justify-between gap-4"><span>Answered 6 questions</span><span className="text-[#4ADE80]">Done</span></li>
        <li className="flex justify-between gap-4 text-[#F7F7F8]"><span>Ready to submit</span><span className="text-[#3D8BFF]">1 min</span></li>
      </ol>
    </div>
  );
}
