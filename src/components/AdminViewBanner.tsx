import { adminViewUserId } from "@/lib/session";
import { findById } from "@/lib/users";
import { exitAdminView } from "@/app/login/actions";

/**
 * Shown on every page while the admin is inside a client's account, so it is
 * never mistaken for the admin's own session — with the way back.
 */
export default async function AdminViewBanner() {
  const uid = await adminViewUserId();
  if (!uid) return null;
  const user = await findById(uid);
  return (
    <div className="relative z-[60] border-b-2 border-warn bg-warnsoft text-ink">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 lg:px-6">
        <p className="text-[13px] leading-snug">
          <span className="font-semibold">Admin view</span> — you are inside{" "}
          <span className="font-semibold">{user?.email ?? uid}</span>&apos;s account, seeing exactly what they see.{" "}
          <span className="text-ink2">Signing, consents, identity photos, the Groww key, password, membership and deletion stay with the client.</span>
        </p>
        <form action={exitAdminView}>
          <button type="submit" className="h-8 shrink-0 bg-ink px-3.5 text-[12.5px] font-semibold text-bg transition-opacity hover:opacity-85">
            ← Back to admin
          </button>
        </form>
      </div>
    </div>
  );
}
