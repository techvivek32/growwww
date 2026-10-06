"use client";

import { useState } from "react";
import KycCapture, { type KycUpload } from "@/components/kyc/KycCapture";

/**
 * The phone side of the QR hand-off. Uploads go to the token's own route —
 * the phone is not signed in; the short-lived link is its only authority.
 */
export default function PhoneCapture({ token, ui, initial }: { token: string; ui: Record<string, string>; initial: { selfie: boolean; id: boolean } }) {
  const [both, setBoth] = useState(initial.selfie && initial.id);
  const [seen, setSeen] = useState(initial);

  const upload: KycUpload = async (kind, photo, liveness) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", photo, `${kind}.jpg`);
    if (liveness) fd.append("liveness", JSON.stringify(liveness));
    try {
      const r = await fetch(`/m/kyc/${token}/upload`, { method: "POST", body: fd });
      if (r.ok) return "ok";
      return r.status === 410 || r.status === 409 ? "expired" : "failed";
    } catch {
      return "failed";
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <KycCapture
        ui={ui}
        upload={upload}
        initial={initial}
        onUploaded={(kind) => {
          const next = { ...seen, [kind]: true };
          setSeen(next);
          setBoth(next.selfie && next.id);
        }}
      />
      {both && (
        <p role="status" className="border-l-2 border-pub-upl pl-3.5 text-[15.5px] leading-relaxed text-pub-cream">
          {ui.phoneDone}
        </p>
      )}
    </div>
  );
}
