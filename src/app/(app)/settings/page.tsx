import type { Metadata } from "next";
import { PageHead, Card, CardHead } from "@/components/ui";

export const metadata: Metadata = { title: "Settings · MNHA Financials" };

/**
 * Deliberately small. Earlier versions listed alert thresholds, risk limits
 * and notification schedules here — none of which were wired to anything.
 * A settings row that nothing reads is not a setting, it is set dressing.
 * Rows return here only when the value they show is actually enforced.
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Settings" sub="Only what actually does something." />

      <Card className="mb-5">
        <CardHead title="Appearance" sub="Theme follows your system unless you pick one" />
        <p className="text-[13.5px] leading-relaxed text-ink2">
          Use the sun / moon control in the top bar. The choice is remembered in this browser only — it
          never leaves your device.
        </p>
      </Card>

      <Card>
        <CardHead title="Not configurable yet" />
        <p className="text-[13.5px] leading-relaxed text-ink2">
          Alert thresholds, risk limits and notifications are not configurable, because nothing enforces
          them yet. The setup engine&apos;s actual rules are fixed and documented on the alerts page: entry at
          the last traded price, stop from the stock&apos;s own range, target at the 20-day closing high
          where one sits above.
        </p>
      </Card>
    </div>
  );
}
