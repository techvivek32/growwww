"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** The admin's hand on Book A's open short: cover it now, or cover and go long the same stock to 15:15. One click, paper only. */
export default function BookAAction({ symbol }: { symbol: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function act(mode: "cover" | "reverse") {
    if (!window.confirm(mode === "cover" ? `Cover the Book A short in ${symbol} now at the live price?` : `Cover the short in ${symbol} and go long it until 15:15?`)) return;
    setBusy(mode);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/paper/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "book-a", mode, symbol }) });
      const j = (await r.json()) as { ok?: boolean; error?: string; result?: { price?: number } };
      setMsg(!r.ok || !j.ok ? j.error ?? `failed (${r.status})` : `done at ₹${j.result?.price ?? "—"}`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => act("cover")} disabled={busy != null} className="rounded-md border border-line bg-paper px-2.5 py-1 text-[11.5px] font-semibold text-ink hover:bg-paper2 disabled:opacity-50">
        {busy === "cover" ? "Covering…" : "Cover short"}
      </button>
      <button type="button" onClick={() => act("reverse")} disabled={busy != null} className="rounded-md border border-up/50 bg-up/10 px-2.5 py-1 text-[11.5px] font-semibold text-up hover:bg-up/20 disabled:opacity-50">
        {busy === "reverse" ? "Reversing…" : "Reverse to long"}
      </button>
      {msg && <span className="text-[11px] text-ink3">{msg}</span>}
    </span>
  );
}
