"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageLoading } from "@/components/product/bits";

type Problems = {
  tried: number;
  failed: number;
  problems: Array<{ site: string; type: string; problem: string; count: number; lastAt: string; examples: Array<{ label: string; answer: string; method: string; reason: string }> }>;
  sites: Array<{ site: string; tried: number; failed: number }>;
  methods: Array<{ method: string; ok: number; tried: number }>;
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
    </div>
  );
}
