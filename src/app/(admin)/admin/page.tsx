import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { liveSummary } from "@/lib/research";
import { loadAdmin } from "./sections";
import { Attention, Engine, Funnel, Hero, KeyStats, Money, PaperSnapshot, RecentAccess, RecentOrders, Signups } from "./dashboard";

export const metadata: Metadata = { title: "Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  await requireAdminPage();
  const { open } = await searchParams;
  const [d, live] = await Promise.all([loadAdmin(), liveSummary()]);
  return (
    <div className="mx-auto max-w-6xl">
      {open === "unlogged" && (
        <p role="alert" className="mb-4 border border-down/30 bg-downsoft px-4 py-3 text-[13px] leading-snug text-down">
          The admin access log could not be written, so the client&apos;s account was not opened. Check the server&apos;s
          data folder, then try again.
        </p>
      )}
      <Hero d={d} />
      <KeyStats d={d} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <PaperSnapshot live={live} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Funnel d={d} />
            <Money d={d} />
          </div>
          <RecentOrders d={d} />
        </div>
        <div className="space-y-4">
          <Attention d={d} />
          <Signups d={d} />
          <Engine d={d} />
          <RecentAccess d={d} />
        </div>
      </div>
    </div>
  );
}
