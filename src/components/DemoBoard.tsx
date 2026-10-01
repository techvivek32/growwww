"use client";

import { useState } from "react";
import type { DemoAccount } from "@/lib/demo";
import { Card, Pill, StatTile } from "@/components/ui";

const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;
const TH = "px-5 py-3 font-mono text-[10.5px] font-normal tracking-[0.08em] text-ink3 uppercase";

export default function DemoBoard({ accounts }: { accounts: DemoAccount[] }) {
  const [active, setActive] = useState(accounts[0]?.id ?? "");
  const acc = accounts.find((a) => a.id === active) ?? accounts[0];
  if (!acc) return null;

  return (
    <div>
      {/* account switcher */}
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Sample accounts">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setActive(a.id)}
            aria-pressed={a.id === active}
            className={`flex min-w-0 items-center gap-2.5 border px-4 py-2.5 text-left transition-colors ${
              a.id === active ? "border-brand bg-brandsoft" : "border-line bg-surface hover:bg-surfaceh"
            }`}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-[12px] font-semibold text-onbrand">
              {a.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </span>
            <span className="leading-tight">
              <span className="block text-[13px] font-semibold text-ink">{a.name}</span>
              <span className="tnum block text-[11.5px] text-ink3">{a.role} · {inr(a.capital)}</span>
            </span>
          </button>
        ))}
      </div>

      {/* summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Capital" value={inr(acc.capital)} sub="sample" />
        <StatTile label="Current value" value={inr(acc.value)} sub="sample" />
        <StatTile label="Total P&L" value={`${acc.pnl >= 0 ? "+" : ""}${inr(acc.pnl)}`} tone={acc.pnl >= 0 ? "up" : "down"} sub="sample · last 5 market days" />
        <StatTile label="Return" value={`${acc.pnlPct >= 0 ? "+" : ""}${acc.pnlPct}%`} tone={acc.pnlPct >= 0 ? "up" : "down"} sub="sample" />
      </div>

      {/* trades */}
      <Card pad={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="pub-display text-[24px] leading-tight text-ink">
              {acc.name} <em>· trades</em>
            </h2>
            <p className="mt-1 text-[12.5px] text-ink3">{acc.trades.length} trades over the last 5 market days · sample data</p>
          </div>
          <Pill tone="warn">Sample</Pill>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface2">
                <th scope="col" className={TH}>Day</th>
                <th scope="col" className={TH}>Instrument</th>
                <th scope="col" className={`${TH} text-right`}>Qty</th>
                <th scope="col" className={`${TH} text-right`}>Buy</th>
                <th scope="col" className={`${TH} text-right`}>Sell</th>
                <th scope="col" className={`${TH} text-right`}>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {acc.trades.map((t, i) => (
                <tr key={i} className="border-b border-line last:border-0 hover:bg-surfaceh">
                  <td className="px-5 py-3 text-[12.5px] whitespace-nowrap text-ink3">{t.day}</td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className="text-[13px] font-medium text-ink">{t.symbol}</span>
                    <Pill tone={t.segment === "FNO" ? "violet" : "neutral"} className="ml-2">
                      {t.segment}
                    </Pill>
                  </td>
                  <td className="tnum px-5 py-3 text-right text-[13px] text-ink2">{t.qty}</td>
                  <td className="tnum px-5 py-3 text-right text-[13px] text-ink2">{t.buy.toFixed(2)}</td>
                  <td className="tnum px-5 py-3 text-right text-[13px] text-ink2">{t.sell.toFixed(2)}</td>
                  <td className={`tnum px-5 py-3 text-right text-[13px] font-semibold ${t.pnl >= 0 ? "text-up" : "text-down"}`}>{t.pnl >= 0 ? "+" : ""}{inr(t.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
