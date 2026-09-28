import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { listUsers } from "@/lib/users";
import { listKyc } from "@/lib/kyc";
import { listConsents, AGREEMENT_VERSION } from "@/lib/consent";
import { engineStatus } from "@/lib/signals/engine";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";
import { adminDisconnectBroker, adminDeleteUser, adminKycDecision, adminScheduleKycCall } from "./actions";

export const metadata: Metadata = { title: "Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;
const withinDays = (ts: number, days: number) => Date.now() - ts < days * DAY;
const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
function ago(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5" style={{ boxShadow: "var(--shadow-card)" }}>
      <p className="text-[11px] tracking-wide text-ink3 uppercase">{label}</p>
      <p className="tnum mt-0.5 text-[22px] font-semibold text-ink">{value}</p>
      {sub && <p className="text-[11.5px] text-ink3">{sub}</p>}
    </div>
  );
}

export default async function AdminPage() {
  // Owner only. A regular user who guesses the URL is sent back to the app.
  if ((await currentUserId()) !== OWNER_ID) redirect("/stocks/alerts");

  const [users, kyc, consents] = await Promise.all([listUsers(), listKyc(), listConsents()]);
  const engine = engineStatus();
  const connected = users.filter((u) => u.hasBroker).length;
  const last7 = users.filter((u) => withinDays(u.createdAt, 7)).length;
  const pendingKyc = kyc.filter((k) => k.status === "submitted").length;
  const emailFor = new Map(users.map((u) => [u.id, u.email]));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead
        title="Admin"
        sub="Platform overview and user management. Broker keys are encrypted and never shown here."
        right={<Pill tone="violet">Owner</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Users" value={String(users.length)} />
        <Stat label="Brokers connected" value={String(connected)} sub={`${users.length - connected} pending`} />
        <Stat label="KYC in review" value={String(pendingKyc)} sub={`${kyc.length} submitted`} />
        <Stat label="New (7 days)" value={String(last7)} />
        <Stat label="Signal engine" value={engine.running ? "Running" : "Idle"} sub={`scan ${ago(engine.lastScan)}`} />
      </div>

      <Card className="mb-6">
        <CardHead title="Signal engine" sub="Shared research runs on the house account" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-[13px]">
          <div><p className="text-ink3">Status</p><p className="font-semibold text-ink">{engine.running ? "Running" : "Idle"}</p></div>
          <div><p className="text-ink3">Scanning now</p><p className="font-semibold text-ink">{engine.scanning ? "Yes" : "No"}</p></div>
          <div><p className="text-ink3">Last scan</p><p className="font-semibold text-ink">{ago(engine.lastScan)}</p></div>
          <div><p className="text-ink3">Edge recomputed</p><p className="font-semibold text-ink">{ago(engine.lastBacktest)}</p></div>
        </div>
      </Card>

      <Card pad={false}>
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Users ({users.length})</h2>
        </div>
        {users.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13.5px] text-ink3">No registered users yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[12px] text-ink3">
                  <th className="px-5 py-3 font-semibold">Email</th>
                  <th className="px-5 py-3 font-semibold">Joined</th>
                  <th className="px-5 py-3 font-semibold">Broker</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-line/60">
                    <td className="px-5 py-3.5">
                      <p className="text-[13.5px] font-medium text-ink">{u.email}</p>
                      <p className="tnum text-[11px] text-ink3">{u.id}</p>
                    </td>
                    <td className="tnum px-5 py-3.5 text-[12.5px] text-ink2">{fmtDate(u.createdAt)}</td>
                    <td className="px-5 py-3.5">
                      {u.hasBroker ? (
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-up">
                          <span className="h-1.5 w-1.5 rounded-full bg-up" /> Connected
                        </span>
                      ) : (
                        <span className="text-[12.5px] text-ink3">Not connected</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        {u.hasBroker && (
                          <form action={adminDisconnectBroker}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button className="rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink2 hover:bg-surfaceh hover:text-ink" title="Remove this user's stored broker credentials">
                              Disconnect
                            </button>
                          </form>
                        )}
                        <form action={adminDeleteUser}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button className="rounded-md border border-down/40 px-2.5 py-1.5 text-[12px] font-medium text-down hover:bg-downsoft" title="Permanently delete this user">
                            Delete
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* KYC review */}
      <Card pad={false} className="mt-6">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Identity verification ({kyc.length})</h2>
          <p className="mt-0.5 text-[12px] text-ink3">Review the selfie + document, do the live call, then approve or reject. This is MNHA&apos;s own check, not a government KYC.</p>
        </div>
        {kyc.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13.5px] text-ink3">No submissions yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {kyc.map((k) => (
              <li key={k.userId} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-ink">
                      {k.fullName}{" "}
                      <span className={`ml-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${
                        k.status === "approved" ? "bg-upsoft text-up" : k.status === "rejected" ? "bg-downsoft text-down" : "bg-warnsoft text-warn"
                      }`}>{k.status}</span>
                    </p>
                    <p className="tnum text-[11.5px] text-ink3">{emailFor.get(k.userId) ?? k.userId} · PAN {k.panMasked} · DOB {k.dob}</p>
                    <p className="text-[11.5px] text-ink3">{k.address}</p>
                  </div>
                  <div className="flex gap-2 text-[12px]">
                    {k.hasSelfie && <a href={`/api/kyc/file?user=${k.userId}&kind=selfie`} target="_blank" rel="noopener noreferrer" className="rounded-md border border-line px-2.5 py-1.5 font-medium text-brandtext hover:bg-surfaceh">Selfie</a>}
                    {k.hasDoc && <a href={`/api/kyc/file?user=${k.userId}&kind=doc`} target="_blank" rel="noopener noreferrer" className="rounded-md border border-line px-2.5 py-1.5 font-medium text-brandtext hover:bg-surfaceh">Document</a>}
                  </div>
                </div>

                {/* schedule the live call */}
                <form action={adminScheduleKycCall} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="userId" value={k.userId} />
                  <label className="text-[11px] text-ink3">Call time
                    <input name="callAt" type="datetime-local" className="mt-1 block h-9 rounded-md border border-line bg-surface px-2 text-[12px] text-ink" />
                  </label>
                  <label className="flex-1 text-[11px] text-ink3">Meeting link
                    <input name="callLink" type="url" placeholder="https://meet.google.com/…" className="mt-1 block h-9 w-full rounded-md border border-line bg-surface px-2 text-[12px] text-ink" />
                  </label>
                  <button className="h-9 rounded-md border border-line px-3 text-[12px] font-medium text-ink2 hover:bg-surfaceh hover:text-ink">Set call</button>
                </form>
                {(k.callAt || k.callLink) && <p className="mt-1 text-[11px] text-ink3">Scheduled{k.callAt ? `: ${fmtDate(k.callAt)}` : ""}{k.callLink ? " · link set" : ""}</p>}

                {/* approve / reject */}
                <form action={adminKycDecision} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="userId" value={k.userId} />
                  <input name="notes" placeholder="Notes (shown to user if rejected)" className="h-9 flex-1 rounded-md border border-line bg-surface px-2.5 text-[12px] text-ink" />
                  <button name="decision" value="approved" className="h-9 rounded-md bg-brand px-3 text-[12px] font-semibold text-white hover:bg-brandh">Approve</button>
                  <button name="decision" value="rejected" className="h-9 rounded-md border border-down/40 px-3 text-[12px] font-semibold text-down hover:bg-downsoft">Reject</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Consent audit */}
      <Card pad={false} className="mt-6">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Consent audit ({consents.length})</h2>
          <p className="mt-0.5 text-[12px] text-ink3">Immutable record of who accepted which agreement version, when, and from where. Current version: {AGREEMENT_VERSION}.</p>
        </div>
        {consents.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13.5px] text-ink3">No consent records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[12px] text-ink3">
                  <th className="px-5 py-3 font-semibold">Signature</th>
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Version</th>
                  <th className="px-5 py-3 font-semibold">When</th>
                  <th className="px-5 py-3 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody>
                {consents.map((c, i) => (
                  <tr key={`${c.userId}-${i}`} className="border-b border-line/60">
                    <td className="px-5 py-3 text-[13px] font-medium text-ink">{c.signatureName}</td>
                    <td className="px-5 py-3 text-[11.5px] text-ink3">{emailFor.get(c.userId) ?? c.userId}</td>
                    <td className="px-5 py-3 text-[12px] text-ink2">{c.agreementVersion}</td>
                    <td className="tnum px-5 py-3 text-[12px] text-ink2">{fmtDate(c.consentedAt)}</td>
                    <td className="tnum px-5 py-3 text-[11.5px] text-ink3">{c.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink3">
        Deleting a user removes their MNHA account, encrypted broker credentials, KYC record + files, and consent records.
        Their money and positions stay with Groww and are unaffected. Broker keys are never decrypted or displayed
        here; KYC files open only through an owner-gated route.
      </p>
    </div>
  );
}
