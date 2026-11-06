"use client";

import Image from "next/image";
import { useRef } from "react";

const SERIF = "font-[family-name:Georgia,'Times_New_Roman',serif]";

/** The founder's note, as a short letter under a photo. Shown as a popup from the home page menu and on its own at /founder. */
export function FounderCard({ onClose }: { onClose?: () => void }) {
  return (
    <article className="relative flex flex-col overflow-hidden rounded-xl border border-[#26262C] bg-[#111114] text-[#F7F7F8]">
      {onClose && (
        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[#070708]/75 text-2xl leading-none text-[#F7F7F8] hover:bg-[#070708]">×</button>
      )}
      <div className="relative aspect-[16/11] w-full">
        <Image src="/founders/drew.jpg" alt="Drew Davis in a suit in front of the White House, shrugging" fill sizes="(min-width: 672px) 640px, 100vw" className="object-cover object-[50%_58%]" priority />
      </div>
      <div className="flex flex-col gap-5 px-6 py-6 sm:px-12 sm:py-10">
        <h2 className={`m-0 ${SERIF} text-[clamp(30px,3.8vw,42px)] font-normal leading-[1.1] tracking-[-1px]`}>Nobody should have to apply to 200 jobs and pray.</h2>
        <div className={`flex flex-col gap-3.5 ${SERIF} text-[17px] leading-[1.6] text-[#C9C9D0]`}>
          <p className="m-0">The job market is broken. Networking is awkward. And the plan everyone hands you is the same resume, retyped into 200 forms.</p>
          <p className="m-0">So I built Unnepo. It fills out the forms, keeps every application in one place, and finds the people to follow up with.</p>
          <p className="m-0">It&apos;s free to start. If it helps, or if it breaks, tell me.</p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2.5">
          <div>
            <p className="hand m-0 text-[44px] font-semibold leading-none">Drew</p>
            <p className="m-0 mt-1 text-sm text-[#9A9AA3]">Founder &amp; CEO</p>
          </div>
          <a href="mailto:agdavi27@colby.edu" className="text-[15px] font-semibold text-[#F7F7F8] underline-offset-4 hover:underline">agdavi27@colby.edu</a>
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
      <button type="button" onClick={() => dialog.current?.showModal()} className="py-3 text-[#9A9AA3] hover:text-white">About the founder</button>
      <dialog ref={dialog} aria-label="About the founder" className="m-auto max-h-[calc(100vh-32px)] w-[min(640px,calc(100vw-32px))] overflow-auto rounded-xl bg-transparent p-0 backdrop:bg-black/70 backdrop:backdrop-blur-[10px]" onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
        <FounderCard onClose={() => dialog.current?.close()} />
      </dialog>
    </>
  );
}
