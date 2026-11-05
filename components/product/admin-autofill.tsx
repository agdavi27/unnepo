"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageLoading } from "@/components/product/bits";

type Problems = {
  tried: number;
  failed: number;
  problems: Array<{ site: string; type: string; problem: string; count: number; lastAt: string; examples: Array<{ label: string; answer: string; method: string; reason: string }> }>;
  sites: Array<{ site: string; tried: number; failed: number }>;
  methods: Array<{ method: string; ok: number; tried: number }>;
  people: { measured: number; averageCents: number; withEmail: number; withVerified: number; providerErrors: number; searched: number; foundNobody: number; byGroup: Array<{ group: string; count: number }>; nobody: Array<{ at: string; company: string; domains: string[]; school: string; steps: string[] }> };
};

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

/** Autofill failures across students' recent applications, most common first. */
export function AutofillProblemsView() {
  const [data, setData] = useState<Problems | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/autofill").then(async (response) => {
      const body = await response.json();
      if (!response.ok) setError(body.error);
      else setData(body);
    });
  }, []);
  if (error) return <div className="p-8 text-red-300">{error}</div>;
  if (!data) return <PageLoading label="Loading autofill problems…" />;
  return (
    <div className="px-4 py-6 lg:px-6">
      <Link href="/admin" className="text-sm text-muted hover:text-cream">← Profitability</Link>
      <h1 className="mt-2 text-4xl font-semibold">Autofill problems</h1>
      <p className="mt-2 text-muted">
        From students&apos; recent applications: {data.tried} questions tried, {data.failed} didn&apos;t fill ({percent(data.failed, data.tried)}).
      </p>
      {!data.problems.length ? (
        <p className="mt-6 rounded-2xl border border-line bg-card p-4 text-muted">No failures recorded yet. They show up here after the extension fills a form.</p>
      ) : (
        <section className="mt-5 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="text-faint"><tr><th className="p-3">Site</th><th>Field</th><th>Problem</th><th className="pr-3 text-right">Times</th></tr></thead>
            <tbody>
              {data.problems.map((row) => {
                const key = `${row.site}|${row.type}|${row.problem}`;
                return (
                  <tr key={key} className="border-t border-line align-top">
                    <td className="p-3">{row.site}</td>
                    <td className="py-3">{row.type}</td>
                    <td className="py-3">
                      <button type="button" className="text-left underline-offset-2 hover:underline" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>{row.problem}</button>
                      {open === key && (
                        <ul className="mt-2 space-y-1 text-muted">
                          {row.examples.map((example, index) => (
                            <li key={index}>“{example.label}”{example.answer ? ` → ${example.answer}` : ""}{example.method ? ` · ${example.method}` : ""}{example.reason ? ` · ${example.reason}` : ""}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums">{row.count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">By site</h2>
          <ul className="mt-3 space-y-1 text-sm text-muted">{data.sites.map((site) => <li key={site.site}>{site.site}: {site.failed} of {site.tried} failed ({percent(site.failed, site.tried)})</li>)}</ul>
        </article>
        <article className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">By field and method</h2>
          <ul className="mt-3 space-y-1 text-sm text-muted">{data.methods.map((method) => <li key={method.method}>{method.method}: {method.ok} of {method.tried} stuck ({percent(method.ok, method.tried)})</li>)}</ul>
        </article>
      </div>
      <h2 className="mt-8 text-2xl font-semibold">People to email</h2>
      <p className="mt-2 text-muted">
        {data.people.searched} recent searches, {data.people.foundNobody} found no one ({percent(data.people.foundNobody, data.people.searched)}).
        {data.people.byGroup.length ? ` ${data.people.byGroup.map((row) => `${row.group}: ${row.count}`).join(" · ")}.` : ""}
        {data.people.providerErrors ? ` ${data.people.providerErrors} had a provider error.` : ""}
      </p>
      {data.people.measured > 0 && <p className="mt-1 text-muted">Of the last {data.people.measured} measured: about {data.people.averageCents}¢ each, {percent(data.people.withEmail, data.people.measured)} ended with an email, {percent(data.people.withVerified, data.people.measured)} with a verified one.</p>}
      <PeopleTest />
      {data.people.nobody.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {data.people.nobody.map((search) => (
            <li key={`${search.company}|${search.at}`} className="rounded-2xl border border-line bg-card p-3">
              <p className="font-medium">{search.company}<span className="text-muted"> · {search.domains.length ? search.domains.join(", ") : "no company match"}{search.school ? ` · ${search.school}` : ""}</span></p>
              <ul className="mt-1 text-muted">{search.steps.map((step, index) => <li key={index}>{step}</li>)}</ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type PeopleResult = { company: string; found: number; failed?: string; reveals?: number; costCents?: number; withEmail?: number; verified?: number; seconds: number; notes?: string[]; people?: Array<{ name: string; title: string; email: string | null; emailSource: string | null; why: string }>; steps?: string[] };

const TEST_COMPANIES = ["Stripe", "Patagonia", "HubSpot", "Spotify", "Nike", "AlphaSights", "Deloitte", "Goldman Sachs", "Procter & Gamble", "Glossier", "Wayfair", "Liberty Mutual", "Fidelity Investments", "Dana-Farber Cancer Institute", "L.L.Bean", "IDEXX", "Unum", "WEX", "Bath Iron Works", "Hannaford", "Tilson Technology", "Allagash Brewing", "Sea Bags", "Maine Medical Center", "Bain & Company", "Ramboll", "Kepware", "Certify", "Nordic Aquafarms", "Revision Energy"];

/** Runs the people search on real companies, one at a time. It spends real money, so it only runs when pressed. */
function PeopleTest() {
  const [list, setList] = useState(TEST_COMPANIES.join("\n"));
  const [title, setTitle] = useState("Marketing Intern");
  const [results, setResults] = useState<PeopleResult[]>([]);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  async function run() {
    const companies = list.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!window.confirm(`Test ${companies.length} companies? This spends real Apollo and Hunter credits, usually under 20¢ each and up to about $${(companies.length * 0.2).toFixed(0)} in all.`)) return;
    stop.current = false;
    setRunning(true);
    setResults([]);
    for (const company of companies) {
      if (stop.current) break;
      const response = await fetch("/api/admin/people-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company, title }) }).catch(() => null);
      const payload = (await response?.json().catch(() => null)) as PeopleResult | { error?: string } | null;
      const row: PeopleResult = response?.ok && payload ? (payload as PeopleResult) : { company, found: 0, failed: (payload as { error?: string } | null)?.error ?? "The request failed.", seconds: 0 };
      setResults((rows) => [...rows, row]);
    }
    setRunning(false);
  }
  const done = results.length;
  const sum = (pick: (row: PeopleResult) => number) => results.reduce((total, row) => total + pick(row), 0);
  return (
    <details className="mt-4 rounded-2xl border border-line bg-card p-4">
      <summary className="cursor-pointer font-medium">Test the people search on real companies</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_16rem]">
        <label className="text-sm text-muted">One company per line<textarea rows={8} value={list} onChange={(event) => setList(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink" /></label>
        <div className="flex flex-col gap-3">
          <label className="text-sm text-muted">Job title to search for<input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink" /></label>
          <button type="button" disabled={running} onClick={() => void run()} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black disabled:opacity-40">{running ? `Running ${done + 1}…` : "Run the test"}</button>
          {running && <button type="button" onClick={() => { stop.current = true; }} className="rounded-xl border border-line px-3 py-2 text-sm">Stop after this one</button>}
        </div>
      </div>
      {done > 0 && (
        <>
          <p role="status" className="mt-3 text-sm">{done} tested: {results.filter((row) => row.found).length} found someone ({percent(results.filter((row) => row.found).length, done)}), {results.filter((row) => row.withEmail).length} with an email, {results.filter((row) => row.verified).length} verified. About {Math.round((sum((row) => row.costCents ?? 0) / done) * 10) / 10}¢ each, {Math.round(sum((row) => row.costCents ?? 0))}¢ in all.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {results.map((row) => (
              <li key={row.company} className="rounded-xl border border-line p-3">
                <details>
                  <summary className="cursor-pointer"><span className="font-medium">{row.company}</span> <span className="text-muted">· {row.failed ? `failed: ${row.failed}` : `${row.found} people, ${row.withEmail ?? 0} with email, ${row.verified ?? 0} verified, ${row.reveals ?? 0} reveals, ${row.costCents ?? 0}¢, ${row.seconds}s`}</span></summary>
                  <ul className="mt-2 space-y-1 text-muted">{(row.people ?? []).map((person) => <li key={person.name}><span className="text-ink">{person.name}</span> · {person.title || "no title"} · {person.email ?? "no email"} ({person.emailSource ?? "none"}) · {person.why}</li>)}</ul>
                  <ul className="mt-2 text-xs text-faint">{(row.steps ?? []).map((step, index) => <li key={index}>{step}</li>)}</ul>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
