"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, Briefcase, Gift, Home, Link2, LogOut, Menu, Search, Send, Settings, Bookmark, X } from "lucide-react";
import { Avatar } from "@/components/product/bits";

type Me = {
  user: { id: string; name: string; email: string; referralCode: string; onboardingStep: string };
  credits: { balance: number; includedAllowance: number; plan: string } | null;
  followups: number;
};

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/contacts", label: "Find New Contacts", icon: Search },
  { href: "/outreach", label: "Outreach & Analytics", icon: Send },
  { href: "/jobs", label: "Job Postings", icon: Briefcase },
  { href: "/saved", label: "Saved Contacts", icon: Bookmark },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => {
        if (response.status === 401) {
          router.push("/login");
          return null;
        }
        return response.json();
      })
      .then((data) => data && setMe(data));
  }, [router]);

  useEffect(() => {
    function onCredits(event: Event) {
      const balance = (event as CustomEvent<number>).detail;
      if (typeof balance !== "number") return;
      setMe((current) => (current?.credits ? { ...current, credits: { ...current.credits, balance } } : current));
    }
    window.addEventListener("unnepo-credits", onCredits);
    return () => window.removeEventListener("unnepo-credits", onCredits);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  const allowance = me?.credits?.includedAllowance || 3;
  const balance = me?.credits?.balance ?? 0;
  const width = Math.min(100, Math.round((balance / allowance) * 100));

  return (
    <div className="min-h-screen bg-bg text-ink md:grid md:grid-cols-[240px_1fr]">
      <aside className={`${open ? "fixed inset-0 z-40 flex" : "hidden"} flex-col border-r border-line bg-panel md:sticky md:top-0 md:flex md:h-screen`}>
        <div className="flex items-center justify-between px-4 py-4">
          <Link href="/home" className="text-2xl font-semibold tracking-tight">unnepo.</Link>
          <button className="md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${active ? "bg-card text-white" : "text-muted hover:bg-white/5 hover:text-white"}`}>
                <Icon className="h-4 w-4" /> {item.label}
              </Link>
            );
          })}
          <Link href="/refer" onClick={() => setOpen(false)} className={`mt-2 block rounded-xl border px-3 py-2.5 ${pathname === "/refer" ? "border-gold bg-gold/15" : "border-gold/35 bg-gold/10 hover:bg-gold/15"}`}>
            <span className="flex items-center gap-2 text-sm font-medium text-cream"><Gift className="h-4 w-4" /> Refer a friend</span>
            <span className="mt-0.5 block pl-6 text-xs text-muted">A verified friend gives you 25 credits</span>
          </Link>
        </nav>
        <div className="space-y-1 px-3 pb-3">
          <Link href="/settings" className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${pathname === "/settings" ? "bg-card text-white" : "text-muted hover:bg-white/5"}`}><Settings className="h-4 w-4" /> Settings</Link>
          <Link href="/settings?tab=integrations" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-white/5"><Link2 className="h-4 w-4" /> Connected Accounts</Link>
        </div>
        <div className="border-t border-line px-4 py-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Credits</span>
            <span className="text-ink">{balance} / {allowance}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-white" style={{ width: `${width}%` }} />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Avatar name={me?.user.name || "Student"} className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{me?.user.name || "Student"}</p>
              <p className="truncate text-xs text-faint">{me?.user.email || "Loading…"}</p>
            </div>
            <button onClick={logout} aria-label="Log out" className="text-faint hover:text-white"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="flex items-center justify-between px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <span className="font-semibold">unnepo.</span>
          <Bell className="h-4 w-4 text-muted" />
        </div>
        {children}
      </div>
    </div>
  );
}
