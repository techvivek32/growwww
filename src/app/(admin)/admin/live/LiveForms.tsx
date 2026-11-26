"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import {
  liveConfirmOrder,
  liveExitAll,
  liveExitOne,
  livePreviewOrder,
  liveSetBase,
  liveSetActiveMode,
  liveSetMode,
  type ExitResult,
  type Msg,
  type OrderFlowState,
  type SentRow,
} from "./actions";

/** One account the admin can tick for an order or an exit. */
export interface AccountOption {
  id: string;
  label: string;
  group: "eligible" | "low" | "blocked" | "excluded" | "reading";
  free: number | null;
}

const eyebrow = "font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const field = "h-9 border border-line2 bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-ink3 focus:border-ink";
const btn = "h-9 px-3.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50";
const btnBrand = `${btn} bg-brand text-onbrand hover:bg-brandh`;
const btnDanger = `${btn} bg-down text-onbrand hover:opacity-90`;
const btnLine = `${btn} border border-line2 text-ink2 hover:bg-surfaceh hover:text-ink`;
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

function Submit({ label, busy, cls = btnBrand, name, value }: { label: string; busy: string; cls?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cls}>
      {pending ? busy : label}
    </button>
  );
}

/**
 * Submit a form through an action WITHOUT React's automatic form reset (React
 * resets a form whose `action` prop is a function once the action finishes —
 * which would quietly put a preview form's fields back to their defaults, e.g.
 * "Everything open" and every account ticked, while the screen still shows the
 * admin's choices).
 */
function submitWith(dispatch: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(fd));
  };
}

function Note({ msg }: { msg: Msg }) {
  if (msg.error) return <p role="alert" className="text-[12.5px] text-down">{msg.error}</p>;
  if (msg.ok) return <p role="status" className="text-[12.5px] text-up">{msg.ok}</p>;
  return null;
}

/* ---------------------------------------------------------------- switch */

const TURN_ON_CHECK =
  "Turn automatic trading ON?\n\nReal orders will go to every eligible client's Groww account, with their money, from the strategy's next step.";

/** The one switch: ON, the strategy trades for real in every eligible account; OFF, nothing new is opened. */
export function ModeForm({ on }: { on: boolean }) {
  const [state, action, busy] = useActionState<Msg, FormData>(liveSetMode, {});
  const send = submitWith(action);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!on && !window.confirm(TURN_ON_CHECK)) {
      e.preventDefault();
      return;
    }
    send(e);
  };
  return (
    <div className="space-y-2">
      <form onSubmit={onSubmit} className={`flex flex-wrap items-center justify-between gap-3 border p-4 ${on ? "border-up/50 bg-upsoft/30" : "border-line bg-surface"}`}>
        <input type="hidden" name="mode" value={on ? "off" : "live"} />
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <span className={`h-2.5 w-2.5 rounded-full ${on ? "live-dot bg-up" : "bg-ink3"}`} />
            Automatic trading is {on ? "ON" : "OFF"}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-ink3">
            {on
              ? "Real orders go to every eligible account: 09:20 entry, market stop, 10:15 flip, 15:15 close."
              : "Nothing new is opened. Turn it ON and everything runs by itself."}
          </p>
        </div>
        <button type="submit" disabled={busy} className={on ? btnLine : btnBrand}>
          {busy ? (on ? "Turning off…" : "Turning on…") : on ? "Turn OFF" : "Turn ON"}
        </button>
      </form>
      <Note msg={state} />
    </div>
  );
}

const ACTIVE_ON_CHECK =
  "Turn the ACTIVE (auto) book ON?\n\nIts rule is NOT backtested. Each trade its 2-minute market scan opens from now (up to 4 a day, 09:35–14:45) is sent as a REAL order to every client's Groww account that has money, sized from that account's free money (up to the trade size), and closed when the scan closes it or at 15:15.";

/** The active (auto) book's own switch: OFF by default. */
export function ActiveModeForm({ on }: { on: boolean }) {
  const [state, action, busy] = useActionState<Msg, FormData>(liveSetActiveMode, {});
  const send = submitWith(action);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!on && !window.confirm(ACTIVE_ON_CHECK)) {
      e.preventDefault();
      return;
    }
    send(e);
  };
  return (
    <div className="space-y-2">
      <form onSubmit={onSubmit} className={`flex flex-wrap items-center justify-between gap-3 border p-4 ${on ? "border-up/50 bg-upsoft/30" : "border-line bg-surface"}`}>
        <input type="hidden" name="mode" value={on ? "off" : "live"} />
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <span className={`h-2.5 w-2.5 rounded-full ${on ? "live-dot bg-up" : "bg-ink3"}`} />
            Active (auto) book is {on ? "ON" : "OFF"}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-ink3">
            {on
              ? "Market scanned every 2 minutes; each trade it opens (up to 4 a day, 09:35–14:45) goes to every account with money, sized from its own free money, and is closed when the scan closes it or at 15:15. Not backtested."
              : "The 2-minute scan trades on paper only. Turn it ON to send its trades to the accounts too."}
          </p>
        </div>
        <button type="submit" disabled={busy} className={on ? btnLine : btnBrand}>
          {busy ? (on ? "Turning off…" : "Turning on…") : on ? "Turn OFF" : "Turn ON"}
        </button>
      </form>
      <Note msg={state} />
    </div>
  );
}

/* ------------------------------------------------------------------ base */

export function BaseForm({ base }: { base: number }) {
  const [state, action] = useActionState<Msg, FormData>(liveSetBase, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className={eyebrow}>Trade size per account (₹)</span>
        <input name="base" inputMode="numeric" defaultValue={base.toLocaleString("en-IN")} className={`${field} w-44`} />
      </label>
      <Submit label="Save" busy="Saving…" />
      <div className="basis-full">
        <Note msg={state} />
      </div>
    </form>
  );
}

/* --------------------------------------------------------- account picker */

function AccountPicker({ accounts, defaults }: { accounts: AccountOption[]; defaults: (a: AccountOption) => boolean }) {
  const usable = accounts.filter((a) => a.group !== "blocked");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(usable.filter(defaults).map((a) => a.id)));
  const set = (ids: string[]) => setPicked(new Set(ids));
  const tag: Record<AccountOption["group"], string> = { eligible: "eligible", low: "low balance", excluded: "kept out of auto", blocked: "blocked", reading: "being read" };
  return (
    <fieldset className="space-y-2">
      <legend className={eyebrow}>Accounts ({picked.size} of {usable.length})</legend>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={btnLine} onClick={() => set(usable.filter((a) => a.group === "eligible").map((a) => a.id))}>
          All eligible
        </button>
        <button type="button" className={btnLine} onClick={() => set(usable.map((a) => a.id))}>
          All
        </button>
        <button type="button" className={btnLine} onClick={() => set([])}>
          None
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto border border-line">
        {usable.length === 0 && <li className="px-3 py-2.5 text-[12.5px] text-ink3">No account can take orders right now.</li>}
        {usable.map((a) => (
          <li key={a.id} className="border-b border-line last:border-0">
            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[12.5px] hover:bg-surfaceh">
              <input
                type="checkbox"
                name="acct"
                value={a.id}
                checked={picked.has(a.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(a.id);
                  else next.delete(a.id);
                  setPicked(next);
                }}
              />
              <span className="min-w-0 flex-1 truncate text-ink">{a.label}</span>
              <span className="tnum text-ink3">{a.free !== null ? inr(a.free) : "—"}</span>
              <span className={`${eyebrow} ${a.group === "eligible" ? "text-up" : a.group === "low" ? "text-warn" : ""}`}>{tag[a.group]}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function SentTable({ rows }: { rows: SentRow[] }) {
  if (!rows.length) return <p className="text-[12.5px] text-ink3">Nothing was sent.</p>;
  const tone = (s: string) => (s === "placed" ? "text-up" : s === "rejected" || s === "refused" ? "text-down" : "text-warn");
  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full min-w-[620px] border-collapse text-left text-[12.5px]">
        <thead>
          <tr className={`border-b border-line ${eyebrow}`}>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Order</th>
            <th className="px-3 py-2 font-medium">Result</th>
            <th className="px-3 py-2 font-medium">Groww</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`} className="border-b border-line last:border-0">
              <td className="max-w-[220px] truncate px-3 py-2 text-ink">{r.label}</td>
              <td className="tnum px-3 py-2 whitespace-nowrap">
                <span className={r.side === "BUY" ? "font-semibold text-up" : "font-semibold text-down"}>{r.side}</span> {r.qty.toLocaleString("en-IN")} {r.symbol}
              </td>
              <td className={`px-3 py-2 font-semibold ${tone(r.state)}`}>{r.state}</td>
              <td className="max-w-[280px] truncate px-3 py-2 text-ink3" title={r.message ?? undefined}>
                {r.orderId ?? ""} {r.message ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- bulk order */

export function OrderFlow({ accounts, base }: { accounts: AccountOption[]; base: number }) {
  const [preview, previewAction, previewing] = useActionState<OrderFlowState, FormData>(livePreviewOrder, {});
  const [sent, sendAction] = useActionState<OrderFlowState, FormData>(liveConfirmOrder, {});
  const [type, setType] = useState("MARKET");
  // The "send it again" tick belongs to ONE preview: a new preview always starts unticked.
  const [againFor, setAgainFor] = useState<string | null>(null);
  const plan = preview.plan;
  const again = Boolean(plan && againFor === plan.id);
  const doneHere = sent.done && plan && sent.done.planId === plan.id;
  const sendCount = plan ? (again ? plan.rows.length : plan.rows.filter((r) => !r.dup).length) : 0;
  return (
    <div className="space-y-4">
      <form onSubmit={submitWith(previewAction)} className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={eyebrow}>Symbol (NSE)</span>
            <input name="symbol" required autoComplete="off" placeholder="TCS" className={`${field} w-36 uppercase`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={eyebrow}>Side</span>
            <select name="side" className={field} defaultValue="BUY">
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={eyebrow}>Product</span>
            <select name="product" className={field} defaultValue="MIS">
              <option value="MIS">Intraday (MIS)</option>
              <option value="CNC">Delivery (CNC)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={eyebrow}>Type</span>
            <select name="type" className={field} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
            </select>
          </label>
          {type === "LIMIT" && (
            <label className="flex flex-col gap-1">
              <span className={eyebrow}>Limit price ₹</span>
              <input name="price" inputMode="decimal" className={`${field} w-28`} />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className={eyebrow}>Amount per account ₹</span>
            <input name="amount" inputMode="numeric" defaultValue={base.toLocaleString("en-IN")} className={`${field} w-36`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={eyebrow}>or Quantity</span>
            <input name="qty" inputMode="numeric" placeholder="from amount" className={`${field} w-28`} />
          </label>
        </div>
        <AccountPicker accounts={accounts} defaults={(a) => a.group === "eligible"} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={previewing} className={btnBrand}>
            {previewing ? "Working it out…" : "Preview"}
          </button>
          {preview.error && <p role="alert" className="text-[12.5px] text-down">{preview.error}</p>}
        </div>
      </form>

      {plan && !doneHere && (
        <div className="space-y-3 border border-ink/70 p-4">
          <p className="text-[13.5px] text-ink">
            <span className={plan.spec.side === "BUY" ? "font-semibold text-up" : "font-semibold text-down"}>{plan.spec.side}</span>{" "}
            <strong>{plan.spec.qty.toLocaleString("en-IN")}</strong> {plan.spec.symbol} · {plan.spec.product === "MIS" ? "intraday" : "delivery"} ·{" "}
            {plan.spec.type === "LIMIT" ? `limit ₹${plan.spec.price}` : "market"} · about {inr(plan.value)} each (at ₹{plan.px}) in{" "}
            <strong>{plan.rows.length}</strong> account{plan.rows.length === 1 ? "" : "s"}.
          </p>
          <ul className="space-y-1 text-[12.5px]">
            {plan.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3">
                <span className="text-ink">{r.label}</span>
                <span className="tnum text-ink3">free {r.free !== null ? inr(r.free) : "—"}</span>
                {r.note && <span className="text-warn">{r.note}</span>}
                {r.dup && <span className="font-semibold text-down">{r.dup}</span>}
              </li>
            ))}
          </ul>
          {plan.refused.length > 0 && <p className="text-[12px] text-warn">Left out (cannot take orders now): {plan.refused.join(", ")}</p>}
          <form action={sendAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="planId" value={plan.id} />
            {plan.rows.some((r) => r.dup) && (
              <label className="flex basis-full items-center gap-2 text-[12.5px] text-ink">
                <input type="checkbox" name="again" value="1" checked={again} onChange={(e) => setAgainFor(e.target.checked ? plan.id : null)} />
                Send it again to the accounts that already got this same order (otherwise they are skipped)
              </label>
            )}
            <Submit label={`Send to ${sendCount} account${sendCount === 1 ? "" : "s"}`} busy="Sending…" cls={btnDanger} />
            <span className="text-[12px] text-ink3">Real orders, sent once. The preview expires in 10 minutes.</span>
          </form>
          {sent.error && (!sent.errorFor || sent.errorFor === plan.id) && <p role="alert" className="text-[12.5px] text-down">{sent.error}</p>}
        </div>
      )}

      {doneHere && sent.done && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-ink">{sent.done.summary}</p>
          {!sent.done.pending && <SentTable rows={sent.done.rows} />}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- live positions */

interface PosRow {
  symbol: string;
  segment: "CASH" | "FNO";
  exchange: "NSE" | "BSE" | null;
  product: string | null;
  net: number | null;
  avg: number | null;
  side: "BUY" | "SELL" | null;
  qty: number;
  skip: string | null;
}

interface PosAccount {
  id: string;
  label: string;
  canExit: boolean;
  at: number | null;
  rows: PosRow[];
  error: string | null;
}

const POLL_MS = 2_000;
const hms = (at: number) => new Date(at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
const kind = (r: PosRow) => `${r.segment === "FNO" ? "F&O · " : ""}${r.product === "MIS" ? "Intraday" : r.product === "CNC" ? "Delivery" : r.product === "NRML" ? "Carry" : "?"}`;

/**
 * Every account's open positions, read again every 2 seconds while the page is
 * open (and in view), with one Exit all and an Exit per position. Each close is
 * sized again from Groww when it is sent, so a list a moment old never closes too much.
 */
export function LivePositions() {
  const [data, setData] = useState<{ at: number; accounts: PosAccount[] } | null>(null);
  const [stale, setStale] = useState(false);
  const [msg, setMsg] = useState<ExitResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const started = Date.now();
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch("/admin/live/positions", { cache: "no-store" });
          const j = r.ok ? await r.json() : null;
          if (stop) return;
          if (j && Array.isArray(j.accounts)) {
            setData(j);
            setStale(false);
          } else setStale(true);
        } catch {
          if (!stop) setStale(true);
        }
      }
      // Every 2 s from the start of the last look, never two looks at once.
      if (!stop) timer = setTimeout(tick, Math.max(300, POLL_MS - (Date.now() - started)));
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const accounts = data?.accounts ?? [];
  const rows = accounts.flatMap((a) => a.rows.map((r) => ({ a, r })));
  const closable = rows.filter(({ a, r }) => a.canExit && r.side && !r.skip);
  const inAccounts = new Set(closable.map(({ a }) => a.id)).size;
  const broken = accounts.filter((a) => a.error);
  const unreachable = accounts.filter((a) => !a.canExit);

  const run = async (key: string, question: string, act: () => Promise<ExitResult>) => {
    if (!window.confirm(question)) return;
    setBusy(key);
    setMsg(null);
    try {
      setMsg(await act());
    } catch {
      setMsg({ error: "The exit could not be started — check Today's orders, then try again." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[12.5px] text-ink3">
          <span className={`h-2 w-2 rounded-full ${data && !stale ? "live-dot bg-up" : "bg-ink3"}`} />
          {data ? `${rows.length} open · updated ${hms(data.at)}` : "Reading Groww…"}
          {stale && <span className="text-warn"> · could not refresh</span>}
        </p>
        <button
          type="button"
          disabled={!closable.length || busy !== null}
          className={`${btnDanger} h-10 px-5 text-[13.5px]`}
          onClick={() =>
            run("all", `Close ALL ${closable.length} open position${closable.length === 1 ? "" : "s"} in ${inAccounts} account${inAccounts === 1 ? "" : "s"} at market?`, () => liveExitAll())
          }
        >
          {busy === "all" ? "Closing…" : `Exit all${closable.length ? ` (${closable.length})` : ""}`}
        </button>
      </div>

      {msg && (
        <div role="status" className="space-y-1 text-[12.5px]">
          {msg.error && <p className="text-down">{msg.error}</p>}
          {msg.ok && <p className="text-up">{msg.ok}</p>}
          {msg.notes?.map((x, i) => (
            <p key={i} className="text-warn">
              {x}
            </p>
          ))}
        </div>
      )}

      {broken.length > 0 && (
        <p className="text-[12px] text-warn">
          Not read just now: {broken.map((a) => `${a.label}${a.at ? ` (showing ${hms(a.at)})` : ""}`).join(", ")}
        </p>
      )}

      {unreachable.length > 0 && (
        <p className="text-[12px] text-ink3">Not shown — cannot take orders now (close in Groww): {unreachable.map((a) => a.label).join(", ")}</p>
      )}

      {data && rows.length === 0 ? (
        <p className="border border-line px-4 py-6 text-center text-[13px] text-ink3">No open positions.</p>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className={`border-b border-line ${eyebrow}`}>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Share</th>
                <th className="px-3 py-2 font-medium">Position</th>
                <th className="px-3 py-2 text-right font-medium">Avg ₹</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, r }) => {
                const key = `${a.id}|${r.segment}|${r.exchange}|${r.symbol}|${r.product}`;
                return (
                  <tr key={key} className="border-b border-line last:border-0">
                    <td className="max-w-[220px] truncate px-3 py-2 text-ink">{a.label}</td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-ink">{r.symbol}</span>
                      <span className="ml-1.5 text-[11px] text-ink3">{kind(r)}</span>
                    </td>
                    <td className="tnum px-3 py-2 whitespace-nowrap">
                      {r.net === null ? (
                        <span className="text-warn">unclear</span>
                      ) : (
                        <span className={r.net > 0 ? "font-semibold text-up" : "font-semibold text-down"}>
                          {r.net > 0 ? "Long" : "Short"} {Math.abs(r.net).toLocaleString("en-IN")}
                        </span>
                      )}
                    </td>
                    <td className="tnum px-3 py-2 text-right text-ink2">{r.avg ? r.avg.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {!a.canExit ? (
                        <span className="text-[11.5px] text-ink3">close in Groww</span>
                      ) : r.side && !r.skip ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          className={btnLine}
                          onClick={() =>
                            run(key, `Close ${r.symbol} (${r.net! > 0 ? "long" : "short"} ${r.qty.toLocaleString("en-IN")}) in ${a.label} at market?`, () =>
                              liveExitOne(a.id, { segment: r.segment, exchange: r.exchange, symbol: r.symbol, product: r.product }),
                            )
                          }
                        >
                          {busy === key ? "Closing…" : "Exit"}
                        </button>
                      ) : (
                        <span className="text-[11.5px] text-ink3">{r.skip}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
