"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import {
  liveConfirmExit,
  liveConfirmOrder,
  livePreviewExit,
  livePreviewOrder,
  liveSetBase,
  liveSetMode,
  type ExitFlowState,
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

/* ------------------------------------------------------------------ mode */

const MODES = [
  { mode: "off", label: "Off", text: "The kill switch: nothing new is opened. What the strategy opened today is still closed (stop, 10:15, 15:15)." },
  { mode: "shadow", label: "Shadow", text: "New trades worked out and recorded, never sent. A day begun live is still closed for real." },
  { mode: "live", label: "Live", text: "Real orders in every eligible account, from the next 09:20 entry." },
] as const;

export function ModeForm({ mode }: { mode: "off" | "shadow" | "live" }) {
  const [state, action] = useActionState<Msg, FormData>(liveSetMode, {});
  const [wantLive, setWantLive] = useState(false);
  return (
    <div className="space-y-3">
      {/* Off and Shadow switch at once; Live has its own form, so Enter in its box can only ever mean Live. */}
      <form action={action} className="grid gap-px border border-line bg-line sm:grid-cols-3">
        {MODES.map((m) => {
          const on = m.mode === mode;
          return (
            <div key={m.mode} className={`bg-surface p-3.5 ${on ? "outline-2 -outline-offset-2 outline-ink" : ""}`}>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-ink">{m.label}</span>
                {on ? (
                  <span className={`${eyebrow} ${m.mode === "live" ? "text-down" : ""}`}>Current</span>
                ) : m.mode === "live" ? (
                  <button type="button" onClick={() => setWantLive(true)} className={btnLine}>
                    Switch…
                  </button>
                ) : (
                  <Submit label="Switch" busy="…" cls={btnLine} name="mode" value={m.mode} />
                )}
              </p>
              <p className="mt-1 text-[12px] leading-snug text-ink3">{m.text}</p>
            </div>
          );
        })}
      </form>
      {wantLive && mode !== "live" && (
        <form action={action} className="flex flex-wrap items-center gap-2 border border-down/40 bg-downsoft/40 p-3">
          <input type="hidden" name="mode" value="live" />
          <p className="basis-full text-[12.5px] text-ink">
            Live sends real orders to clients&apos; Groww accounts with their money, from the next 09:20 entry (a day already begun in shadow
            stays simulated). Type <strong>LIVE</strong> to confirm.
          </p>
          <input name="confirm" autoComplete="off" placeholder="LIVE" className={`${field} w-28`} />
          <Submit label="Switch to Live" busy="Switching…" cls={btnDanger} />
          <button type="button" onClick={() => setWantLive(false)} className={btnLine}>
            Cancel
          </button>
        </form>
      )}
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
        <span className={eyebrow}>Base value (₹ per trade, per account)</span>
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

/* ------------------------------------------------------------------ exits */

export function ExitFlow({ accounts, suggestions }: { accounts: AccountOption[]; suggestions: string[] }) {
  const [preview, previewAction, previewing] = useActionState<ExitFlowState, FormData>(livePreviewExit, {});
  const [sent, sendAction] = useActionState<ExitFlowState, FormData>(liveConfirmExit, {});
  const [scope, setScope] = useState<"all" | "symbol">("all");
  const [symbol, setSymbol] = useState("");
  const plan = preview.plan;
  const doneHere = sent.done && plan && sent.done.planId === plan.id;
  const toClose = plan ? plan.accounts.reduce((n, a) => n + a.rows.filter((r) => r.side && !r.skip).length, 0) : 0;
  return (
    <div className="space-y-4">
      <form onSubmit={submitWith(previewAction)} className="space-y-3">
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} />
            Everything open
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="symbol" checked={scope === "symbol"} onChange={() => setScope("symbol")} />
            One symbol
          </label>
          {scope === "symbol" && (
            <>
              <input name="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="TCS" className={`${field} w-40 uppercase`} />
              {suggestions.map((s) => (
                <button key={s} type="button" className={btnLine} onClick={() => setSymbol(s)}>
                  {s}
                </button>
              ))}
            </>
          )}
        </div>
        <AccountPicker accounts={accounts} defaults={() => true} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={previewing} className={btnBrand}>
            {previewing ? "Reading Groww…" : "Show positions"}
          </button>
          {preview.error && <p role="alert" className="text-[12.5px] text-down">{preview.error}</p>}
        </div>
      </form>

      {plan && !doneHere && (
        <div className="space-y-3 border border-ink/70 p-4">
          <p className="text-[14px] font-semibold text-ink">
            Close {plan.symbol ? <span className="text-down">{plan.symbol}</span> : <span className="text-down">EVERYTHING open</span>} in {plan.accounts.length} account
            {plan.accounts.length === 1 ? "" : "s"}:
          </p>
          {plan.accounts.map((a) => (
            <div key={a.id}>
              <p className="text-[12.5px] font-semibold text-ink">{a.label}</p>
              {a.error ? (
                <p className="text-[12px] text-down">{a.error}</p>
              ) : a.rows.length === 0 ? (
                <p className="text-[12px] text-ink3">No open position{plan.symbol ? ` in ${plan.symbol}` : ""}.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-[12px]">
                  {a.rows.map((r, i) => (
                    <li key={i} className="tnum flex flex-wrap gap-x-2">
                      <span className="text-ink">{r.symbol}</span>
                      <span className="text-ink3">
                        {r.segment} · {r.product ?? "?"} · {r.exchange ?? "?"} · net {r.net ?? "?"}
                        {r.avg ? ` @ ₹${r.avg}` : ""}
                      </span>
                      {r.side && !r.skip ? (
                        <span className={r.side === "BUY" ? "font-semibold text-up" : "font-semibold text-down"}>
                          → {r.side} {r.qty.toLocaleString("en-IN")} at market
                        </span>
                      ) : (
                        <span className="text-warn">left alone: {r.skip}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {plan.refused.length > 0 && <p className="text-[12px] text-warn">Left out (cannot send orders now): {plan.refused.join(", ")}</p>}
          {toClose > 0 ? (
            <form action={sendAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="planId" value={plan.id} />
              <input name="confirm" autoComplete="off" placeholder="EXIT" className={`${field} w-24`} />
              <Submit label={`Close ${toClose} position${toClose === 1 ? "" : "s"}`} busy="Closing…" cls={btnDanger} />
              <span className="text-[12px] text-ink3">Type EXIT. Each close is sized again from Groww at the moment it is sent.</span>
            </form>
          ) : (
            <p className="text-[12.5px] text-ink3">Nothing to close.</p>
          )}
          {sent.error && (!sent.errorFor || sent.errorFor === plan.id) && <p role="alert" className="text-[12.5px] text-down">{sent.error}</p>}
        </div>
      )}

      {doneHere && sent.done && (
        <div className="space-y-3">
          <p className="text-[13px] font-semibold text-ink">{sent.done.summary}</p>
          {!sent.done.pending && <SentTable rows={sent.done.accounts.flatMap((a) => a.sent)} />}
          {sent.done.accounts
            .filter((a) => a.error || a.skipped.length)
            .map((a) => (
              <p key={a.id} className="text-[12px] text-warn">
                {a.label}: {a.error ?? a.skipped.map((r) => `${r.symbol} left alone (${r.skip})`).join("; ")}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
