import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/** Getting the extension: add it from the Chrome Web Store, then connect it to the account. */
export function InstallExtension({ storeUrl }: { storeUrl: string }) {
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
        <p className="text-sm text-[#9A9AA3]">Unnepo works in a side panel in Chrome. It&apos;s free to add and takes a few seconds.</p>
        <ol className="m-0 list-none space-y-3 p-0">
          <li className={step}>
            <span className={number}>1</span>
            <div className="space-y-3 text-sm">
              <p className="m-0 font-semibold">Add it to Chrome</p>
              <p className="m-0 text-[#9A9AA3]">On the Chrome Web Store, press <strong className="text-ink">Add to Chrome</strong>.</p>
              <a href={storeUrl} target="_blank" rel="noreferrer" className={primary}>Add to Chrome</a>
            </div>
          </li>
          <li className={step}>
            <span className={number}>2</span>
            <div className="space-y-1 text-sm">
              <p className="m-0 font-semibold">Pin it</p>
              <p className="m-0 text-[#9A9AA3]">Click the puzzle piece <span aria-hidden="true">🧩</span> at the top right of Chrome, then the pin next to Unnepo, so it&apos;s one click away.</p>
            </div>
          </li>
          <li className={step}>
            <span className={number}>3</span>
            <div className="space-y-3 text-sm">
              <p className="m-0 font-semibold">Connect it to your account</p>
              <p className="m-0 text-[#9A9AA3]">Click the Unnepo icon to open the side panel and press Connect, or connect from here.</p>
              <Link href="/extension/connect" className={secondary}>Connect the extension</Link>
            </div>
          </li>
        </ol>
      </main>
    </div>
  );
}
