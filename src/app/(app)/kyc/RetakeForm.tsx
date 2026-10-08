"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { retakeKycPhotosAction, type KycState } from "./actions";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function checkSize(e: React.ChangeEvent<HTMLInputElement>) {
  const f = e.target.files?.[0];
  e.target.setCustomValidity(f && f.size > MAX_FILE_BYTES ? "This file is larger than 5 MB." : "");
}

const fileField =
  "block w-full text-[12.5px] text-ink2 file:mr-3 file:h-9 file:border file:border-solid file:border-line2 file:bg-transparent file:px-3 file:text-[12.5px] file:font-semibold file:text-ink hover:file:bg-surfaceh";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center bg-brand text-[14.5px] font-semibold text-onbrand transition-colors hover:bg-brandh disabled:opacity-60"
    >
      {pending ? "Uploading…" : "Replace photo"}
    </button>
  );
}

/**
 * Fix a bad shot without redoing the whole form. Only the files are sent —
 * name, PAN, date of birth and address stay exactly as submitted.
 */
export default function RetakeForm({ hasDoc }: { hasDoc: boolean }) {
  const [state, action] = useActionState<KycState, FormData>(retakeKycPhotosAction, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
          New selfie <span className="normal-case tracking-normal text-ink3">(optional)</span>
        </label>
        <input
          name="selfie"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="user"
          onChange={checkSize}
          className={fileField}
        />
      </div>

      <div>
        <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
          {hasDoc ? "Replace ID document" : "Add ID document"}{" "}
          <span className="normal-case tracking-normal text-ink3">(optional)</span>
        </label>
        <input
          name="doc"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={checkSize}
          className={fileField}
        />
      </div>

      <p className="text-[12px] leading-relaxed text-ink3">
        Pick whichever one is wrong — the other stays as it is. The photo you replace is deleted, so the reviewer
        only ever sees the latest one.
      </p>

      {state.error && (
        <p className="border-l-2 border-down bg-downsoft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">{state.error}</p>
      )}
      {state.ok && !state.error && (
        <p className="border-l-2 border-up bg-upsoft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
          Updated. Your new photo is with the reviewer.
        </p>
      )}

      <Submit />
    </form>
  );
}
