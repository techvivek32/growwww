"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { submitKycAction, type KycState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="mt-2 inline-flex h-11 w-full items-center justify-center bg-brand text-[14.5px] font-semibold text-onbrand transition-colors hover:bg-brandh disabled:opacity-60">
      {pending ? "Submitting…" : "Submit for verification"}
    </button>
  );
}

const field = "h-11 w-full border border-line2 bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-ink";
const label = "mb-1.5 block font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";
const fileField = "block w-full text-[12.5px] text-ink2 file:mr-3 file:h-9 file:border file:border-solid file:border-line2 file:bg-transparent file:px-3 file:text-[12.5px] file:font-semibold file:text-ink hover:file:bg-surfaceh";

export default function KycForm() {
  const [state, action] = useActionState<KycState, FormData>(submitKycAction, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className={label}>Full name (as on PAN)</span>
        <input name="fullName" required maxLength={120} placeholder="Your full legal name" className={field} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>PAN</span>
          <input name="pan" required placeholder="ABCDE1234F" maxLength={10} autoCapitalize="characters" spellCheck={false} className={`${field} font-mono uppercase`} />
        </label>
        <label className="block">
          <span className={label}>Date of birth</span>
          <input name="dob" type="date" required className={field} />
        </label>
      </div>
      <label className="block">
        <span className={label}>Address</span>
        <textarea name="address" required rows={2} maxLength={400} placeholder="Your current address" className={`${field} h-auto resize-none py-2.5`} />
      </label>
      <label className="block">
        <span className={label}>Selfie (live photo)</span>
        <input name="selfie" type="file" accept="image/jpeg,image/png,image/webp" capture="user" required className={fileField} />
        <span className="mt-1 block text-[11px] text-ink3">A clear photo of your face. JPG/PNG/WebP, up to 5 MB.</span>
      </label>
      <label className="block">
        <span className={label}>ID document (optional now)</span>
        <input name="doc" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className={fileField} />
        <span className="mt-1 block text-[11px] text-ink3">PAN card / Aadhaar / passport. JPG/PNG/PDF, up to 5 MB.</span>
      </label>

      <label className="flex items-start gap-2.5 border-y border-line py-3.5">
        <input name="consent" type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--c-mark)]" />
        <span className="text-[12px] leading-relaxed text-ink2">
          I consent to MNHA Financials collecting and storing my name, PAN, date of birth, address, photo and any
          document I upload, for the sole purpose of verifying my identity. I understand my PAN and DOB are stored
          encrypted, that I can request deletion at any time from Settings, and that this is MNHA&apos;s own internal
          check — not a government or SEBI KYC.
        </span>
      </label>

      {state.error && <p role="alert" className="border-l-2 border-down bg-downsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">{state.error}</p>}
      <Submit />
    </form>
  );
}
