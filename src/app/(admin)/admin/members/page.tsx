import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/access";
import { PageHead, Pill } from "@/components/ui";
import { loadAdmin, MembersSection } from "../sections";

export const metadata: Metadata = { title: "Members · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdminPage();
  const d = await loadAdmin();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHead title="Members" sub="Performance-fee members and their last-known NAV." right={<Pill tone="violet">Admin</Pill>} />
      <MembersSection d={d} />
    </div>
  );
}
