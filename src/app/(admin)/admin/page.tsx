import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { liveSummary } from "@/lib/research";
import { loadAdmin } from "./sections";
import { Attention, Engine, Funnel, Hero, KeyStats, Money, PaperSnapshot, RecentAccess, RecentOrders, Signups } from "./dashboard";

export const metadata: Metadata = { title: "Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminPage();
  const [d, live] = await Promise.all([loadAdmin(), liveSummary()]);
  return (
    <div className="mx-auto max-w-6xl">
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
