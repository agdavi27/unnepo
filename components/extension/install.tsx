"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/** The extension, built by `npm run extension:zip` (extension/build.mjs copies it here). */
export const EXTENSION_ZIP = "/downloads/unnepo-extension.zip";

/**
 * Getting the extension. Once the Chrome Web Store lists it (NEXT_PUBLIC_CHROME_EXTENSION_URL), that's the
 * way in. Until then the page downloads the zip as it opens and walks through loading it in Chrome by hand.
 */
export function InstallExtension({ storeUrl, version }: { storeUrl: string | null; version: string }) {
  const started = useRef(false);
  const [copied, setCopied] = useState(false);

  // Starts the download once, as the page opens: "Get the extension" should just download it.
  useEffect(() => {
    if (storeUrl || started.current) return;
    started.current = true;
    const link = document.createElement("a");
    link.href = EXTENSION_ZIP;
    link.download = "unnepo-extension.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [storeUrl]);

  const step = "flex gap-4 rounded-2xl border border-[#17171B] bg-[#0C0C0E] p-5";
  const number = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white font-mono text-xs font-bold text-black";
  const primary = "inline-flex min-h-11 items-center rounded-[10px] bg-white px-5 text-sm font-semibold text-black hover:bg-zinc-200";
  const secondary = "inline-flex min-h-11 items-center rounded-[10px] border border-[#26262C] px-5 text-sm hover:bg-white/5";

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Logo href="/home" className="text-xl font-bold tracking-[-0.6px]" />
        <Link href="/home" className="whitespace-nowrap text-sm text-[#9A9AA3] hover:text-white">Back to Unnepo</Link>
      </header>
      <main className="mx-auto max-w-xl space-y-6 px-6 pb-20 pt-8">
        <p className="font-mono text-[11px] uppercase tracking-[1.2px] text-[#8B8B94]">Chrome extension</p>
        <h1 className="text-[32px] font-bold leading-tight tracking-[-1.2px]">Get the extension</h1>

        {storeUrl ? (
          <>
            <p className="text-sm text-[#9A9AA3]">Add Unnepo from the Chrome Web Store, then connect it to your account.</p>
            <div className="flex flex-wrap gap-3">
              <a href={storeUrl} target="_blank" rel="noreferrer" className={primary}>Add to Chrome</a>
              <Link href="/extension/connect" className={secondary}>Connect the extension</Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-[#9A9AA3]">
              Your download started. Unnepo is waiting on Chrome Web Store approval, so for now you add it to Chrome by hand. It takes about two minutes.
            </p>
            <a href={EXTENSION_ZIP} download className={secondary}>Download again (version {version})</a>

            <ol className="m-0 list-none space-y-3 p-0">
              <li className={step}>
                <span className={number}>1</span>
                <div className="space-y-1 text-sm">
                  <p className="m-0 font-semibold">Unzip it</p>
                  <p className="m-0 text-[#9A9AA3]">Open <span className="font-mono text-[#B4B4BC]">unnepo-extension.zip</span> from your Downloads, and move the folder somewhere it&apos;ll stay, like Documents. Chrome runs Unnepo from that folder, so don&apos;t delete it.</p>
                </div>
              </li>
              <li className={step}>
                <span className={number}>2</span>
                <div className="space-y-2 text-sm">
                  <p className="m-0 font-semibold">Open Chrome&apos;s extensions page</p>
                  <p className="m-0 text-[#9A9AA3]">Paste this into Chrome&apos;s address bar, then turn on <strong className="text-ink">Developer mode</strong> in the top right.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded-lg border border-[#26262C] px-3 py-2 font-mono text-xs text-[#B4B4BC]">chrome://extensions</code>
                    <button type="button" className="min-h-9 rounded-lg border border-[#26262C] px-3 text-sm hover:bg-white/5" onClick={() => void navigator.clipboard.writeText("chrome://extensions").then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
                  </div>
                </div>
              </li>
              <li className={step}>
                <span className={number}>3</span>
                <div className="space-y-1 text-sm">
                  <p className="m-0 font-semibold">Load it</p>
                  <p className="m-0 text-[#9A9AA3]">Click <strong className="text-ink">Load unpacked</strong> and choose the unzipped folder (the one with <span className="font-mono text-[#B4B4BC]">manifest.json</span> inside). Then pin Unnepo from the puzzle-piece icon in the toolbar.</p>
                </div>
              </li>
              <li className={step}>
                <span className={number}>4</span>
                <div className="space-y-3 text-sm">
                  <p className="m-0 font-semibold">Connect it to your account</p>
                  <p className="m-0 text-[#9A9AA3]">Click the Unnepo icon to open the side panel, or connect from here.</p>
                  <Link href="/extension/connect" className={primary}>Connect the extension</Link>
                </div>
              </li>
            </ol>
            <p className="text-xs text-[#8B8B94]">Chrome may show a note about developer mode extensions when it starts. That&apos;s normal for an extension added this way. Once Unnepo is in the Chrome Web Store, you can switch to the store version to get updates on their own.</p>
          </>
        )}
      </main>
    </div>
  );
}
