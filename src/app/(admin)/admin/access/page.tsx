import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Pill } from "@/components/ui";
import { loadAdmin, AccessSection } from "../sections";

export const metadata: Metadata = { title: "Admin access log · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  const d = await loadAdmin();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead title="Admin access log" sub="Every time the admin opened or left a client's account, and every act inside it: connecting Groww, or sending an order or a cancellation." right={<Pill tone="violet">Admin</Pill>} />
      <AccessSection d={d} />
    </div>
  );
}
