"use client";

import { useEffect, useState } from "react";
import { PageLoading } from "@/components/product/bits";
import { dollars } from "@/lib/format";

export function AdminView() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/admin/metrics").then(async (response) => {
      const body = await response.json();
      if (!response.ok) setError(body.error);
      else setData(body);
    });
  }, []);
  if (error) return <div className="p-8 text-red-300">{error}</div>;
  if (!data) return <PageLoading label="Loading profitability…" />;
  const revenue = data.revenue as Record<string, number | boolean>;
  const expenses = data.expenses as Record<string, number | boolean>;
  const unit = data.unit as Record<string, number>;
  const providers = data.providers as Array<Record<string, number | string | boolean>>;
  const alerts = data.alerts as Array<{ level: string; message: string }>;
  return (
    <div className="px-4 py-6 lg:px-6">
      <h1 className="text-4xl font-semibold">Profitability</h1>
      <p className="mt-2 text-muted">Estimated provider costs are marked. Demo checkouts are excluded from revenue.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Card title="Revenue" lines={[`Total ${dollars(Number(revenue.totalCents))}`, `MRR ${dollars(Number(revenue.mrrCents))}`, `Paying customers ${revenue.payingCustomers}`, `ARPU ${dollars(Number(revenue.arpuCents))}`, `Refunds ${dollars(Number(revenue.refundCents))}`, `Cancellations ${revenue.cancellations}`]} />
        <Card title="Expenses" lines={[`Contact APIs ${dollars(Number(expenses.contactApiCents))} est.`, `AI APIs ${dollars(Number(expenses.aiApiCents))} est.`, `Email infra ${dollars(Number(expenses.emailInfraCents))} est.`, `Stripe fees ${dollars(Number(expenses.stripeFeeCents))} est.`, `Hosting ${dollars(Number(expenses.hostingCents))} est.`]} />
        <Card title="Unit economics" lines={[`Cost / unlock ${dollars(Number(unit.costPerUnlockCents))}`, `Cost / AI email ${dollars(Number(unit.costPerEmailCents))}`, `Revenue / credit ${dollars(Number(unit.revenuePerCreditCents))}`, `Variable cost / customer ${dollars(Number(unit.variableCostPerCustomerCents))}`, `Gross margin ${Math.round(Number(unit.grossMargin) * 100)}%`, `Gross profit ${dollars(Number(unit.grossProfitCents))}`]} />
      </div>
      <section className="mt-4 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="text-faint"><tr><th className="p-3">Provider</th><th>Calls</th><th>Success</th><th>Failure</th><th>Cost</th><th>Cost / success</th><th>Latency</th></tr></thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={String(provider.provider)} className="border-t border-line">
                <td className="p-3">{String(provider.provider)}{provider.estimated ? " · est." : ""}</td>
                <td>{String(provider.calls)}</td>
                <td>{Math.round(Number(provider.successRate) * 100)}%</td>
                <td>{Math.round(Number(provider.failureRate) * 100)}%</td>
                <td>{dollars(Number(provider.costCents))}</td>
                <td>{dollars(Number(provider.costPerSuccessCents))}</td>
                <td>{String(provider.averageLatencyMs)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <ul className="mt-4 space-y-2 text-sm">
        {alerts.map((alert) => <li key={alert.message} className={alert.level === "warning" ? "text-cream" : "text-muted"}>{alert.message}</li>)}
      </ul>
    </div>
  );
}

function Card({ title, lines }: { title: string; lines: string[] }) {
  return <article className="rounded-2xl border border-line bg-card p-4"><h2 className="font-semibold">{title}</h2><ul className="mt-3 space-y-1 text-sm text-muted">{lines.map((line) => <li key={line}>{line}</li>)}</ul></article>;
}
