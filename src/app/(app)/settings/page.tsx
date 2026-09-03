import type { Metadata } from "next";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Settings · MNHA Financials" };

interface Row {
  label: string;
  detail: string;
  value: string;
  tone?: "brand" | "warn" | "neutral";
}

const ALERTS: Row[] = [
  { label: "Minimum score", detail: "Setups below this are not published.", value: "75" },
  { label: "Minimum risk / reward", detail: "Rejects setups whose target is too close to the stop.", value: "1.8" },
  { label: "Scan interval", detail: "How often the NSE universe is re-scanned during market hours.", value: "10 min" },
  { label: "Regime gate", detail: "Throttle long setups when NIFTY 50 is below its 20 EMA.", value: "On", tone: "brand" },
];

const RISK: Row[] = [
  { label: "Max risk per trade", detail: "Position size is derived from this and the stop distance.", value: "₹2,000" },
  { label: "Max open positions", detail: "New entries are blocked once this many are working.", value: "5" },
  { label: "Daily loss limit", detail: "Trading halts for the session once breached.", value: "₹6,000" },
  { label: "Default product", detail: "Applied to equity orders unless overridden per trade.", value: "MIS" },
];

const NOTIFY: Row[] = [
  { label: "Pre-market summary", detail: "Sent before the open with the regime call and watchlist.", value: "08:45 IST" },
  { label: "Daily statement", detail: "Session P&L, fills and charges.", value: "15:45 IST" },
  { label: "Monthly statement", detail: "Sent on the last trading day of each month.", value: "On", tone: "brand" },
  { label: "Order failure alerts", detail: "Any non-success from the order endpoint pages you immediately.", value: "On", tone: "brand" },
];

function Group({ title, sub, rows }: { title: string; sub: string; rows: Row[] }) {
  return (
    <Card className="mb-5">
      <CardHead title={title} sub={sub} />
      <ul>
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-4 border-b border-line py-3 first:pt-0 last:border-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink">{r.label}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink3">{r.detail}</p>
            </div>
            <div className="shrink-0">
              {r.tone ? (
                <Pill tone={r.tone}>{r.value}</Pill>
              ) : (
                <span className="tnum text-[13px] font-semibold text-ink">{r.value}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead
        title="Settings"
        sub="Alert thresholds, risk limits and notification schedule. All times are IST."
      />

      <Group
        title="Alerts"
        sub="What the engine is allowed to publish"
        rows={ALERTS}
      />
      <Group
        title="Risk"
        sub="Hard limits the order desk enforces before anything is sent"
        rows={RISK}
      />
      <Group
        title="Notifications"
        sub="Scheduled on the NSE calendar, not a fixed clock"
        rows={NOTIFY}
      />

      <Card>
        <CardHead title="Appearance" sub="Theme follows your system unless you pick one" />
        <p className="text-[13px] leading-relaxed text-ink2">
          Use the sun / moon control in the top bar. The choice is remembered in this browser only — it never leaves
          your device.
        </p>
      </Card>
    </div>
  );
}
