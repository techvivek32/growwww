import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { listForUser } from "@/lib/notifications";
import { PageHead, Card, Empty } from "@/components/ui";
import { markAllReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications · MNHA Financials" };
export const dynamic = "force-dynamic";

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const dot: Record<string, string> = {
  up: "bg-up",
  down: "bg-down",
  warn: "bg-warn",
  neutral: "bg-ink3",
};

export default async function NotificationsPage() {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  const items = await listForUser(uid);
  const anyUnread = items.some((i) => !i.read);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHead
        title="Notifications"
        sub="Your account and order events. Only your own — never anyone else's."
        right={
          anyUnread ? (
            <form action={markAllReadAction}>
              <button type="submit" className="inline-flex h-9 items-center rounded-lg border border-line px-3.5 text-[12.5px] font-semibold text-ink2 hover:bg-surfaceh hover:text-ink">
                Mark all read
              </button>
            </form>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <Card pad={false}>
          <Empty title="Nothing yet" hint="Order confirmations, broker connection status and account events will show up here." />
        </Card>
      ) : (
        <Card pad={false}>
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className={`flex gap-3 px-4 py-3.5 ${n.read ? "" : "bg-brandsoft/25"}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[n.tone] ?? "bg-ink3"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13.5px] font-semibold text-ink">{n.title}</p>
                    <span className="shrink-0 text-[11px] text-ink3">{ago(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink2">{n.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
