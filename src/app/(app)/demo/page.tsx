import type { Metadata } from "next";
import { getDemoAccounts } from "@/lib/demo";
import { PageHead, Pill } from "@/components/ui";
import DemoBoard from "@/components/DemoBoard";

export const metadata: Metadata = { title: "Demo workspace · MNHA Financials" };
export const dynamic = "force-dynamic";

export default function DemoPage() {
  const accounts = getDemoAccounts();

  return (
    <>
      <PageHead
        title="Linked accounts"
        sub="Multiple accounts in one view, with their recent trades and P&L."
        right={<Pill tone="warn">Demo</Pill>}
      />

      {/* honest banner — kept simple, but always present */}
      <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-warn/40 bg-warnsoft/50 px-4 py-2.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-warn">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        <p className="text-[12.5px] leading-snug text-ink2">
          <strong className="text-ink">Demo workspace — sample data.</strong> These are illustrative figures to show how
          the platform looks, not real trades, holdings or returns.
        </p>
      </div>

      <DemoBoard accounts={accounts} />
    </>
  );
}
