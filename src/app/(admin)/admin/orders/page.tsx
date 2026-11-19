import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Pill } from "@/components/ui";
import { loadAdmin, OrdersSection } from "../sections";

export const metadata: Metadata = { title: "Order log · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  const d = await loadAdmin();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead title="Order log" sub="Every order sent through MNHA." right={<Pill tone="violet">Admin</Pill>} />
      <OrdersSection d={d} />
    </div>
  );
}
