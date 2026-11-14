"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { extensionHere } from "@/lib/extension-bridge";

/** Resolves true once the extension's script on this page posts `type`, false after `ms`. */
function waitFor(type: string, ms: number) {
  return new Promise<boolean>((resolve) => {
    const done = (answer: boolean) => { window.removeEventListener("message", listen); clearTimeout(timer); resolve(answer); };
    const listen = (event: MessageEvent) => { if (event.source === window && (event.data as { type?: unknown } | null)?.type === type) done(true); };
    const timer = setTimeout(() => done(false), ms);
    window.addEventListener("message", listen);
  });
}

/**
 * Links the Chrome extension to the signed-in account. The extension's content script listens on this
 * page for the token; if it isn't installed yet, the student can copy the code into the extension instead.
 */
export function ConnectExtension() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState("");
  const [copied, setCopied] = useState(false);

  async function connect() {
    setState("busy");
    setProblem("");
    try {
      const response = await fetch("/api/extension/token", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.replace("/login?next=/extension/connect");
        return;
      }
      if (!response.ok) throw new Error(body.error || "Couldn't connect the extension.");
      setCode(body.token);
      // Only this page's own origin receives the message; the extension's content script runs here.
      const installed = await extensionHere(800);
      const connected = waitFor("unnepo:extension-connected", 2500);
      window.postMessage({ type: "unnepo:extension-token", token: body.token, expiresAt: body.expiresAt }, window.location.origin);
      if (installed) {
        // The extension has the token: straight to the dashboard. Older extensions don't say so, so it waits a moment.
        await connected;
        router.push("/home?connected=1");
        return;
      }
      setState("done");
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Couldn't connect the extension.");
      setState("idle");
    }
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Logo href="/home" className="text-xl font-bold tracking-[-0.6px]" />
        <Link href="/home" className="text-sm text-[#9A9AA3] hover:text-white">Back to Unnepo</Link>
      </header>
      <main className="mx-auto max-w-xl space-y-6 px-6 pb-20 pt-8">
        <p className="font-mono text-[11px] uppercase tracking-[1.2px] text-[#8B8B94]">Chrome extension</p>
        <h1 className="text-[32px] font-bold leading-tight tracking-[-1.2px]">Connect the extension</h1>
        <p className="text-sm text-[#9A9AA3]">The extension fills applications from your Unnepo profile, right in your own browser. Connecting lets it read your profile and log the jobs you apply to. Your job-site passwords stay in the extension and never reach Unnepo.</p>
        {state !== "done" ? (
          <button type="button" onClick={() => void connect()} disabled={state === "busy"} className="inline-flex min-h-11 items-center rounded-[10px] bg-white px-5 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50">
            {state === "busy" ? "Connecting…" : "Connect this browser's extension"}
          </button>
        ) : (
          <div className="space-y-3 rounded-2xl border border-[#17171B] bg-[#0C0C0E] p-5">
            <p className="text-sm">Unnepo couldn&apos;t find the extension in this browser. Add it, then press Connect on Unnepo in its panel, or paste this code there:</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-[#26262C] px-3 py-2 font-mono text-xs text-[#B4B4BC]">{code}</code>
              <button type="button" className="min-h-10 rounded-lg border border-[#26262C] px-3 text-sm hover:bg-white/5" onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true))}>{copied ? "Copied" : "Copy code"}</button>
            </div>
            <p className="text-xs text-[#8B8B94]">Treat this code like a password. It works for 90 days, only for the extension. Connecting again makes a new one.</p>
          </div>
        )}
        {problem && <p role="alert" className="text-sm text-red-300">{problem}</p>}
      </main>
    </div>
  );
}
