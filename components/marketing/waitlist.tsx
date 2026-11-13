"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DancingSpider } from "@/components/marketing/spider-dialogue";

/**
 * The landing page's "Join the waitlist" button. It opens a popup asking for a name, an email and, if they like, a
 * phone number. Once it's saved, the spider dances.
 */
export function WaitlistButton({ label = "Join the waitlist", className }: { label?: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [joined, setJoined] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    const reset = () => setProblem("");
    el?.addEventListener("close", reset);
    return () => el?.removeEventListener("close", reset);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, phone }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Couldn't save that. Try again.");
      setJoined(body.firstName || name.split(" ")[0]);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = "min-h-12 w-full rounded-[10px] border border-[#26262C] bg-[#070708] px-3.5 text-[15px] text-[#F7F7F8] outline-none placeholder:text-[#5E5E66] focus:border-[#3D8BFF]";

  return (
    <>
      <button type="button" className={className} onClick={() => dialog.current?.showModal()}>{label}</button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto max-h-[calc(100vh-32px)] w-[min(440px,calc(100vw-32px))] overflow-auto rounded-2xl border border-[#26262C] bg-[#0C0C0E] p-0 text-[#F7F7F8] backdrop:bg-black/70 backdrop:backdrop-blur-[6px]"
        onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}
      >
        <div className="relative flex flex-col gap-5 p-6">
          <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="absolute right-3 top-3 rounded-lg px-2 py-1 text-xl leading-none text-[#8B8B94] hover:text-white">×</button>
          {joined ? (
            <div className="flex flex-col items-center gap-4 py-2 text-center" role="status">
              <div className="relative w-[160px] pt-6">
                <span aria-hidden className="spider-dance-note absolute left-0 top-6 text-2xl text-[#3D8BFF]">♪</span>
                <span aria-hidden className="spider-dance-note absolute right-1 top-2 text-xl text-[#F7F7F8] [animation-delay:.9s]">♫</span>
                <DancingSpider className="spider-dance" />
                <div aria-hidden className="mx-auto mt-1 h-2 w-24 rounded-[50%] bg-[#3D8BFF]/25" />
              </div>
              <h2 id={titleId} className="m-0 text-2xl font-bold tracking-[-0.6px]">You&apos;re on the list{joined ? `, ${joined}` : ""}!</h2>
              <p className="m-0 max-w-[320px] text-sm leading-relaxed text-[#9A9AA3]">We&apos;ll let you know the moment Unnepo launches. The spider is very excited.</p>
              <button type="button" onClick={() => dialog.current?.close()} className="mt-1 min-h-[46px] w-full rounded-[10px] bg-[#3D8BFF] text-sm font-semibold text-bg hover:bg-[#5A9DFF]">Done</button>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="pr-8">
                <p className="m-0 font-mono text-[11px] uppercase tracking-[1.6px] text-[#8B8B94]">Get notified at launch</p>
                <h2 id={titleId} className="m-0 mt-2 text-2xl font-bold tracking-[-0.6px]">Join the waitlist</h2>
              </div>
              <p className="m-0 text-sm leading-relaxed text-[#9A9AA3]">Unnepo isn&apos;t open yet. Leave your details and you&apos;ll hear from us the day it launches.</p>
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                Name
                <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={field} placeholder="Your name" maxLength={120} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                Email
                <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={field} placeholder="you@school.edu" maxLength={200} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                <span>Phone number <span className="font-normal text-[#8B8B94]">(optional)</span></span>
                <input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className={field} placeholder="(555) 123-4567" maxLength={40} />
              </label>
              {problem && <p role="alert" className="m-0 text-sm text-[#FF8A8A]">{problem}</p>}
              <button type="submit" disabled={busy} className="mt-1 min-h-[50px] rounded-[10px] bg-[#3D8BFF] text-[15px] font-semibold text-bg transition-colors hover:bg-[#5A9DFF] disabled:opacity-60">
                {busy ? "Saving…" : "Notify me at launch"}
              </button>
              <p className="m-0 text-center text-xs text-[#8B8B94]">We&apos;ll only use this to tell you about the launch.</p>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
