"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** One click closes an open manual paper trade at the live price; the row re-renders from the research box. */
export default function ManualExit({ symbol, entryTime }: { symbol: string; entryTime: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function exit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/paper/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "exit", symbol, entry_time: entryTime }) });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) setErr(j.error ?? `failed (${r.status})`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={exit} disabled={busy} className="rounded-md border border-down/50 bg-down/10 px-2.5 py-1 text-[11.5px] font-semibold text-down hover:bg-down/20 disabled:opacity-50">
        {busy ? "Exiting…" : "Exit now"}
      </button>
      {err && <span className="text-[11px] text-down">{err}</span>}
    </span>
  );
}
