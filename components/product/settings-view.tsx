"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bell, Copy, Gift } from "lucide-react";
import { ResumeFile } from "@/components/product/bits";
import { PUBLIC_PLANS } from "@/lib/config";
import { SCHOOLS } from "@/lib/schools";

const profileSchema = z.object({
  name: z.string().min(1, "Add your name"),
  school: z.string().min(1, "Select your school"),
  major: z.string().optional(),
  graduationYear: z.string().optional(),
  bio: z.string().max(300).optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

export function SettingsView({ initialTab = "profile", initialMessage = "" }: { initialTab?: string; initialMessage?: string }) {
  const [tab, setTab] = useState(initialTab);
  const [me, setMe] = useState<{ user: { name: string; email: string; referralCode: string }; credits: { balance: number; includedAllowance: number; plan: string } | null; mailboxes: Array<{ provider: string; email: string }> } | null>(null);
  const [facts, setFacts] = useState<Array<{ id: string; category: string; detail: string }>>([]);
  const [history, setHistory] = useState<Array<{ id: string; kind: string; status: string; amountCents: number; creditsGranted: number; demo: boolean; createdAt: string }>>([]);
  const [message, setMessage] = useState(initialMessage);
  const [referralCode, setReferralCode] = useState("");
  const [resumeName, setResumeName] = useState("");
  const form = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: { name: "", school: "", major: "", graduationYear: "", bio: "" } });

  useEffect(() => {
    fetch("/api/me").then((response) => response.json()).then((data) => {
      setMe(data);
      form.reset({
        name: data.profile?.name || data.user?.name || "",
        school: data.profile?.school || "",
        major: data.profile?.major || "",
        graduationYear: data.profile?.graduationYear || "",
        bio: data.profile?.bio || "",
      });
      setResumeName(data.resume?.fileName || "");
    });
    fetch("/api/facts").then((response) => response.json()).then((data) => setFacts(data.facts ?? []));
    fetch("/api/billing/history").then((response) => response.json()).then((data) => setHistory(data.payments ?? []));
    // Load the signed-in profile once; later saves update local state directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile(values: ProfileForm) {
    const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const data = await response.json();
    setMessage(response.ok ? "Profile saved." : data.error);
  }

  async function upload(file: File) {
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/resume", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) setMessage(data.error);
    else {
      setResumeName(data.resume.fileName);
      setFacts(data.facts ?? []);
      setMessage(data.cached ? "This file was already parsed. Cached facts were reused." : `Parsed ${data.facts.length} facts from the resume. Nothing was invented.`);
    }
  }

  async function checkout(kind: "pro" | "premium" | "grind" | "pack") {
    const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    const data = await response.json();
    if (data.url) window.location.href = data.url;
    else setMessage(data.error || "Checkout could not start.");
  }

  async function applyReferral() {
    const response = await fetch("/api/billing/referral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: referralCode }) });
    const data = await response.json();
    setMessage(response.ok ? data.message : data.error || "Could not apply that code.");
  }

  const balance = me?.credits?.balance ?? 0;
  const allowance = me?.credits?.includedAllowance || 3;

  return (
    <div className="px-4 py-5 lg:px-8">
      <div className="mb-4 hidden justify-end md:flex"><Bell className="h-4 w-4 text-muted" /></div>
      <h1 className="text-4xl font-semibold">Settings</h1>
      <div className="mt-4 flex gap-6 border-b border-line text-sm">
        {["profile", "account", "integrations", "billing"].map((item) => (
          <button key={item} onClick={() => setTab(item)} className={`pb-3 capitalize ${tab === item ? "border-b-2 border-white text-white" : "text-muted"}`}>{item}</button>
        ))}
      </div>
      {message ? <p className="mt-4 text-sm text-cream">{message}</p> : null}
      {tab === "profile" ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <form onSubmit={form.handleSubmit(saveProfile)} className="rounded-2xl border border-line bg-card p-5">
              <h2 className="font-semibold">Profile</h2>
              <p className="text-sm text-faint">This info helps personalize your outreach emails.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field label="Name" error={form.formState.errors.name?.message}><input {...form.register("name")} className="field" /></Field>
                <Field label="School" error={form.formState.errors.school?.message}>
                  <select {...form.register("school")} className="field">
                    <option value="">Select your school</option>
                    {SCHOOLS.map((school) => <option key={school}>{school}</option>)}
                  </select>
                </Field>
                <Field label="Major (optional)"><input {...form.register("major")} placeholder="e.g. Economics" className="field" /></Field>
                <Field label="Graduation Year (optional)">
                  <select {...form.register("graduationYear")} className="field">
                    <option value="">e.g. 2026</option>
                    {["2025", "2026", "2027", "2028", "2029", "2030"].map((year) => <option key={year}>{year}</option>)}
                  </select>
                </Field>
              </div>
              <label className="mt-3 block text-sm text-muted">Short Bio (optional)
                <textarea {...form.register("bio")} maxLength={300} placeholder="Briefly describe your background, interests, or what you're looking for..." className="field mt-1 h-24" />
              </label>
              <button className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black">Save profile</button>
            </form>
            <section className="rounded-2xl border border-line bg-card p-5">
              <h2 className="font-semibold">Resume</h2>
              <p className="text-sm text-faint">Upload your resume to help generate personalized emails.</p>
              {resumeName ? <div className="mt-4"><ResumeFile name={resumeName} /></div> : null}
              <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl border border-line bg-panel px-4 py-3 text-sm">
                <span>{resumeName ? "Replace resume" : "Upload resume (PDF or DOCX)"}</span>
                <span className="rounded-lg border border-line px-3 py-1">{resumeName ? "Replace file" : "Choose file"}</span>
                <input type="file" accept=".pdf,.docx,application/pdf" className="hidden" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
              </label>
              <p className="mt-2 text-xs text-faint">Your resume is only used to personalize your emails and isn&apos;t shared with anyone.</p>
              {facts.length ? (
                <ul className="mt-4 space-y-2 text-sm">
                  {facts.map((fact) => (
                    <li key={fact.id} className="rounded-lg border border-line px-3 py-2">
                      <span className="text-faint">{fact.category}: </span>{fact.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
          <div className="space-y-4">
            <section className="rounded-2xl border border-line bg-card p-5">
              <div className="flex items-center justify-between"><h2 className="font-semibold">Your credits</h2><button onClick={() => setTab("billing")} className="text-xs text-muted">View usage →</button></div>
              <p className="mt-3 text-4xl font-semibold">{balance} / {allowance}</p>
              <div className="mt-3 h-1.5 rounded-full bg-zinc-800"><div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, (balance / allowance) * 100)}%` }} /></div>
              <p className="mt-2 text-xs text-faint">Credits refill when you refer friends or upgrade.</p>
              <button onClick={() => setTab("billing")} className="mt-4 h-11 w-full rounded-xl bg-white text-sm font-semibold text-black">Get more credits</button>
            </section>
            <section className="rounded-2xl bg-cream p-5 text-black">
              <div className="flex items-start justify-between">
                <div>
                  <p className="flex items-center gap-2 font-semibold"><Gift className="h-4 w-4" /> Refer a friend</p>
                  <p className="text-2xl font-semibold">Get 25 free credits</p>
                  <p className="mt-1 text-sm">Share your code. You get 25 credits when a friend verifies their school email. They still receive their signup credits.</p>
                </div>
                <span className="text-5xl">🎁</span>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-black/20 bg-white/60 px-3 py-2 font-mono">
                {me?.user.referralCode || "——"}
                <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/signup?ref=${me?.user.referralCode || ""}`)} aria-label="Copy referral link"><Copy className="h-4 w-4" /></button>
              </div>
              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/signup?ref=${me?.user.referralCode || ""}`)} className="mt-3 h-11 w-full rounded-xl bg-black text-sm font-semibold text-white">Share your code</button>
            </section>
          </div>
        </div>
      ) : null}
      {tab === "account" ? (
        <section className="mt-6 max-w-xl space-y-3 rounded-2xl border border-line bg-card p-5 text-sm">
          <p>Signed in as {me?.user.email}</p>
          <a className="block text-cream" href="/api/account/export">Download my data</a>
          <button className="text-red-300" onClick={async () => { if (confirm("Delete your Unnepo account and personal data?")) { await fetch("/api/account", { method: "DELETE" }); window.location.href = "/"; } }}>Delete account</button>
          <p className="text-faint">A search that returns people costs 1 credit and saves them. Unlocking a verified work email costs 1 credit only when an email comes back. AI drafts are on Pro and Premium. Sending from your mailbox is included.</p>
        </section>
      ) : null}
      {tab === "integrations" ? (
        <section className="mt-6 grid max-w-2xl gap-3">
          <ConnectCard title="Gmail" detail={me?.mailboxes.find((item) => item.provider === "gmail")?.email || "Send from your own inbox"} href="/api/oauth/gmail" />
          <ConnectCard title="Outlook" detail={me?.mailboxes.find((item) => item.provider === "outlook")?.email || "Microsoft 365 mailbox"} href="/api/oauth/outlook" />
        </section>
      ) : null}
      {tab === "billing" ? (
        <section className="mt-6 space-y-5">
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-line bg-card p-5">
              <p className="text-xs font-semibold tracking-[0.16em] text-faint">YOUR BALANCE</p>
              <p className="mt-3 text-5xl font-semibold tracking-tight">{balance}</p>
              <p className="text-sm text-muted">credits · about {balance * 10} people</p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-[#3D8BFF]" style={{ width: `${Math.min(100, (balance / allowance) * 100)}%` }} />
              </div>
              <p className="mt-3 text-sm capitalize text-faint">Plan: {me?.credits?.plan || "free"}</p>
            </div>
            <div className="rounded-2xl border border-gold/40 bg-gold/10 p-5">
              <p className="font-semibold text-cream">Have a friend’s code?</p>
              <p className="mt-1 text-sm text-muted">Apply it before you pay. A verified school email gives them 25 credits.</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input value={referralCode} onChange={(event) => setReferralCode(event.target.value.toUpperCase())} placeholder="Referral code" className="field font-mono uppercase" />
                <button type="button" onClick={applyReferral} className="h-11 rounded-xl bg-white px-4 text-sm font-semibold text-black">Apply code</button>
              </div>
            </div>
          </div>
          {(me?.credits?.plan === "grind" || me?.credits?.plan === "pack") ? (
            <p className="text-sm text-muted">You&apos;re on the legacy {me.credits.plan === "grind" ? "Grind" : "credit pack"} plan. That price and those credits stay as they are. New purchases use Pro and Premium.</p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-3">
            {PUBLIC_PLANS.map((plan) => {
              const current = (me?.credits?.plan || "free") === plan.id;
              return (
                <article key={plan.id} className={`flex flex-col rounded-2xl border p-5 ${plan.popular ? "border-gold bg-card" : "border-line bg-card"} ${current ? "ring-1 ring-white" : ""}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">{plan.blurb}</span>
                    {current ? <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-black">Current</span> : plan.popular ? <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-black">Most popular</span> : null}
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold">{plan.name}</h2>
                  <p className="mt-2 text-4xl font-semibold">{plan.priceLabel}{plan.monthly ? <span className="text-lg text-muted"> / month</span> : null}</p>
                  <p className="mt-2 font-semibold text-[#3D8BFF]">{plan.peopleLabel}</p>
                  <p className="mt-1 text-sm text-faint">{plan.cadence}</p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm text-muted">
                    {plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}
                  </ul>
                  {plan.id === "free" ? (
                    <p className="mt-5 text-sm text-faint">Included when you verify a school email.</p>
                  ) : (
                    <button onClick={() => checkout(plan.id)} className={`mt-5 h-11 rounded-xl text-sm font-semibold ${plan.popular ? "bg-cream text-black" : "bg-white text-black"}`}>{plan.cta}</button>
                  )}
                </article>
              );
            })}
          </div>
          <div className="rounded-2xl border border-line">
            <p className="border-b border-line px-4 py-3 text-sm font-semibold">Payments</p>
            {history.length === 0 ? <p className="p-4 text-sm text-muted">No purchases yet. A demo checkout is labeled and is not revenue.</p> : history.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between border-b border-line px-4 py-3 text-sm last:border-0">
                <span>{payment.kind} · {payment.status}{payment.demo ? " · demo" : ""}</span>
                <span>{payment.creditsGranted} credits · ${(payment.amountCents / 100).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm text-muted">{label}{children}{error ? <span className="text-xs text-red-300">{error}</span> : null}</label>;
}

function ConnectCard({ title, detail, href }: { title: string; detail: string; href: string }) {
  return (
    <a href={href} className="flex items-center justify-between rounded-2xl border border-line bg-card px-4 py-4">
      <span><span className="block font-medium">{title}</span><span className="text-sm text-faint">{detail}</span></span>
      <span className="rounded-lg bg-white px-3 py-1 text-sm font-semibold text-black">Connect</span>
    </a>
  );
}
