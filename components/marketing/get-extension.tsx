"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The home page's main button. Before sending the student to the Chrome Web Store (or sign-up, until the
 * extension is listed), it asks for their school email and says whether their school pays for Unnepo.
 * Nothing typed here is saved.
 */

type Check = { status: "covered" | "not_covered"; school: string } | { status: "not_school"; message: string };

export function GetExtension({ href, external }: { href: string; external: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const el = dialog.current;
    const reset = () => { setResult(null); setProblem(""); };
    el?.addEventListener("close", reset);
    return () => el?.removeEventListener("close", reset);
  }, []);

  async function check(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch("/api/schools/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Couldn't check right now.");
      setResult(body as Check);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't check right now.");
    } finally {
      setBusy(false);
    }
  }

  const go = { href, ...(external ? { target: "_blank", rel: "noreferrer" } : {}) };
  const pixelButton = "inline-flex min-h-12 items-center justify-center border-4 border-bg bg-[#F7F7F8] px-[26px] py-[18px] text-center font-[family-name:var(--font-pixel)] text-sm leading-[1.6] text-bg shadow-[6px_6px_0_#3D8BFF] transition-transform hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[4px_4px_0_#3D8BFF] active:translate-x-1.5 active:translate-y-1.5 active:shadow-none";

  return (
    <>
      <button type="button" className={pixelButton} onClick={() => dialog.current?.showModal()}>
        Get the Chrome extension
      </button>
      <dialog ref={dialog} aria-labelledby="school-check-title" className="m-auto w-[min(440px,calc(100vw-32px))] rounded-2xl border border-[#26262C] bg-[#0C0C0E] p-0 text-[#F7F7F8] backdrop:bg-black/70">
        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="m-0 font-mono text-[11px] uppercase tracking-[1.6px] text-[#8B8B94]">Before you install</p>
              <h2 id="school-check-title" className="m-0 mt-2 text-2xl font-bold tracking-[-0.6px]">Does your school cover Unnepo?</h2>
            </div>
            <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="-mr-2 -mt-1 rounded-lg px-2 py-1 text-xl leading-none text-[#8B8B94] hover:text-white">×</button>
          </div>
          <p className="m-0 text-sm leading-relaxed text-[#9A9AA3]">Some schools pay for Unnepo Pro for their students. Enter your school email to see. Unnepo is free to start either way.</p>
          <form onSubmit={check} className="flex gap-2">
            <label htmlFor="school-email" className="sr-only">School email</label>
            <input id="school-email" type="email" required value={email} onChange={(event) => { setEmail(event.target.value); setResult(null); }} placeholder="you@school.edu" autoComplete="email" className="min-h-11 flex-1 rounded-[10px] border border-[#26262C] bg-[#070708] px-3 text-sm text-[#F7F7F8] outline-none placeholder:text-[#6B6B74] focus:border-[#3D8BFF]" />
            <button type="submit" disabled={busy} className="min-h-11 rounded-[10px] bg-[#F7F7F8] px-4 text-sm font-semibold text-black hover:bg-white disabled:opacity-50">{busy ? "Checking…" : "Check"}</button>
          </form>
          <div role="status" aria-live="polite" className="empty:hidden">
            {problem && <p className="m-0 text-sm text-[#FCA5A5]">{problem}</p>}
            {result?.status === "not_school" && <p className="m-0 text-sm text-[#F5A524]">{result.message}</p>}
            {result?.status === "covered" && (
              <div className="rounded-xl border border-[#1F4D33] bg-[#0B1F14] p-4 text-sm leading-relaxed">
                <p className="m-0 font-semibold text-[#4ADE80]">Good news: {result.school} covers Unnepo Pro.</p>
                <p className="m-0 mt-1 text-[#B4B4BC]">Add the extension, then sign up with your school email to get it.</p>
              </div>
            )}
            {result?.status === "not_covered" && (
              <div className="rounded-xl border border-[#26262C] bg-[#111114] p-4 text-sm leading-relaxed">
                <p className="m-0 font-semibold">{result.school} doesn&apos;t cover Unnepo yet.</p>
                <p className="m-0 mt-1 text-[#9A9AA3]">You can start free and upgrade whenever you&apos;re applying a lot. Want it at your school? Send your career center our way.</p>
              </div>
            )}
          </div>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            {/* Until the extension is listed in the Chrome Web Store, this starts sign-up instead. */}
            <a {...go} className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-[#3D8BFF] px-4 text-sm font-semibold text-white hover:bg-[#5A9DFF]">{external ? "Add to Chrome" : "Create your account"}</a>
            {!result && <a {...go} className="text-sm text-[#8B8B94] underline-offset-4 hover:text-white hover:underline">Skip, just add it</a>}
          </div>
        </div>
      </dialog>
    </>
  );
}
