"use client";

import { useState } from "react";

/**
 * /get on a phone (or a browser that isn't Chrome): one email field that sends the install link to open on a
 * computer. The only script on the page.
 */
export function InstallLinkForm({ source }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [sentTo, setSentTo] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) {
      setProblem("Enter a real email address, like you@gmail.com.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch("/api/install-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "We couldn't send the email just now. Try again in a minute.");
      setSentTo(body.email || email);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "We couldn't send the email just now. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div role="status" aria-live="polite" className="flex w-full flex-col gap-2 rounded-xl border border-[#1F4D33] bg-[#0B1F14] p-5">
        <p className="m-0 text-lg font-semibold text-[#4ADE80]">Sent! Check your inbox.</p>
        <p className="m-0 text-[15px] leading-relaxed text-[#B4B4BC]">
          The install link is on its way to <strong className="break-all font-semibold text-[#F7F7F8]">{sentTo}</strong>. Open it on your computer and press Add to Chrome. Not there in a minute? Check spam.
        </p>
        <button type="button" onClick={() => { setSentTo(""); setEmail(""); }} className="mt-1 self-start text-sm text-[#9A9AA3] underline underline-offset-4 hover:text-white">
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-3">
      <label htmlFor="install-email" className="text-sm font-medium text-[#B4B4BC]">Your email</label>
      <input
        id="install-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        required
        maxLength={254}
        value={email}
        onChange={(event) => { setEmail(event.target.value); setProblem(""); }}
        placeholder="you@school.edu"
        aria-invalid={Boolean(problem)}
        aria-describedby={problem ? "install-email-problem" : undefined}
        className="min-h-[54px] w-full rounded-[10px] border border-[#3A3A42] bg-[#070708] px-4 text-base text-[#F7F7F8] outline-none placeholder:text-[#6B6B74] focus:border-[#3D8BFF]"
      />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-[54px] w-full items-center justify-center rounded-[10px] bg-[#3D8BFF] px-6 text-base font-semibold text-bg transition-colors hover:bg-[#5A9DFF] disabled:opacity-60"
      >
        {busy ? "Sending…" : "Email me the install link"}
      </button>
      {problem && <p id="install-email-problem" role="alert" className="m-0 text-sm text-[#FCA5A5]">{problem}</p>}
      <p className="m-0 text-[13px] leading-normal text-[#9A9AA3]">One email now and one reminder tomorrow. Unsubscribe any time.</p>
    </form>
  );
}
