"use client";

import { useState } from "react";
import type { LinkedAccount } from "@/lib/linked-accounts";
import { Card } from "@/components/ui";

const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;

function Stat({ label, value, tone = "text-ink", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5" style={{ boxShadow: "var(--shadow-card)" }}>
      <p className="text-[11px] tracking-wide text-ink3 uppercase">{label}</p>
      <p className={`tnum mt-0.5 text-[20px] font-semibold ${tone}`}>{value}</p>
      {sub && <p className="tnum text-[11.5px] text-ink3">{sub}</p>}
    </div>
  );
}

export default function LinkedAccountsBoard({ accounts }: { accounts: LinkedAccount[] }) {
  const [active, setActive] = useState(accounts[0]?.id ?? "");
  const acc = accounts.find((a) => a.id === active) ?? accounts[0];
  if (!acc) return null;

  return (
    <div>
      {/* account switcher */}
      <div className="mb-5 flex flex-wrap gap-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setActive(a.id)}
            className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-left transition-colors ${
              a.id === active ? "border-brand bg-brandsoft" : "border-line bg-surface hover:bg-surfaceh"
            }`}
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-[12px] font-bold text-white">
              {a.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </span>
            <span className="leading-tight">
              <span className="block text-[13px] font-semibold text-ink">{a.name}</span>
              <span className="block text-[11px] text-ink3">{a.role} · {inr(a.capital)}</span>
            </span>
          </button>
        ))}
      </div>

      {/* summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Capital" value={inr(acc.capital)} />
        <Stat label="Current value" value={inr(acc.value)} tone="text-ink" />
        <Stat label="Total P&L" value={`${acc.pnl >= 0 ? "+" : ""}${inr(acc.pnl)}`} tone={acc.pnl >= 0 ? "text-up" : "text-down"} sub="last 5 market days" />
        <Stat label="Return" value={`${acc.pnlPct >= 0 ? "+" : ""}${acc.pnlPct}%`} tone={acc.pnlPct >= 0 ? "text-up" : "text-down"} />
      </div>

      {/* trades */}
      <Card pad={false}>
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{acc.name} · trades</h2>
          <p className="mt-0.5 text-[12px] text-ink3">{acc.trades.length} trades over the last 5 market days</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface2 text-[12px] font-semibold tracking-wide text-ink3">
                <th className="px-5 py-3">Day</th>
                <th className="px-5 py-3">Instrument</th>
                <th className="px-5 py-3 text-right">Qty</th>
                <th className="px-5 py-3 text-right">Buy</th>
                <th className="px-5 py-3 text-right">Sell</th>
                <th className="px-5 py-3 text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {acc.trades.map((t, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-3 text-[12.5px] text-ink3">{t.day}</td>
                  <td className="px-5 py-3">
                    <span className="text-[13px] font-medium text-ink">{t.symbol}</span>
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.segment === "FNO" ? "bg-violetsoft text-violet" : "bg-surface2 text-ink3"}`}>{t.segment}</span>
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
