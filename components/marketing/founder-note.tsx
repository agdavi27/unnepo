"use client";

import Image from "next/image";
import { useRef } from "react";

/** The founder's note, in Drew's words. Shown as a popup from the home page menu and on its own at /founder. */
export function FounderCard({ onClose }: { onClose?: () => void }) {
  return (
    <article className="relative grid overflow-hidden rounded-[20px] bg-white text-[#0A0A0B] md:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] md:gap-10 md:p-7">
      {onClose && (
        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-2xl leading-none text-[#0A0A0B] hover:bg-[#F0F0F2] md:right-5 md:top-5">×</button>
      )}
      <div className="relative aspect-[4/5] w-full md:aspect-auto md:min-h-[560px]">
        <Image src="/founders/drew.jpg" alt="Drew Davis in a suit in front of the White House, shrugging" fill sizes="(min-width: 768px) 420px, 100vw" className="object-cover object-[50%_35%] md:rounded-[14px]" priority />
      </div>
      <div className="flex flex-col gap-4 px-6 py-7 md:px-0 md:py-3 md:pr-6">
        <p className="m-0 font-mono text-xs uppercase tracking-[1.4px] text-[#6B6B74]">About the founder</p>
        <h2 className="m-0 text-[clamp(34px,4.6vw,52px)] font-bold leading-[0.98] tracking-[-2px]">My mom thinks I should get a real job.</h2>
        <div className="flex flex-col gap-3.5 text-[16px] leading-relaxed text-[#26262C]">
          <p className="m-0">I think I should own the company that helps everyone else get one.</p>
          <p className="m-0">One of us is going to be right.</p>
          <p className="m-0">In the meantime, I built Unnepo because the job market is broken, networking is awkward, and students deserve something better than applying to 200 jobs and praying.</p>
          <p className="m-0">Anyway, enjoy the software.</p>
          <p className="m-0">Oh, and btw, did we mention you can use it for free?</p>
          <p className="m-0">You&apos;re welcome.</p>
          <p className="m-0">Email me: <a href="mailto:agdavi27@colby.edu" className="font-semibold text-[#0A0A0B] underline-offset-4 hover:underline">agdavi27@colby.edu</a></p>
        </div>
        <div className="mt-2">
          <p className="m-0 text-2xl font-bold tracking-[-0.6px]">— Drew Davis</p>
          <p className="m-0 text-[15px] text-[#6B6B74]">Founder &amp; CEO</p>
        </div>
      </div>
    </article>
  );
}

/** The menu link that opens the founder's note as a popup. */
export function FounderLink() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className="py-3 text-[#9A9AA3] hover:text-white">Founder</button>
      <dialog ref={dialog} aria-label="About the founder" className="m-auto max-h-[calc(100vh-32px)] w-[min(1100px,calc(100vw-32px))] overflow-auto rounded-[20px] bg-transparent p-0 backdrop:bg-black/70" onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
        <FounderCard onClose={() => dialog.current?.close()} />
      </dialog>
    </>
  );
}
