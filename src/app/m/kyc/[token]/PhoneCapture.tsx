"use client";

import { useState } from "react";

type Kind = "selfie" | "id";
type Ui = Record<"selfie" | "selfieHint" | "id" | "idHint" | "take" | "retake" | "done" | "expired" | "failed" | "uploading", string>;

/** Shrink a phone photo before upload (long edge 1600px, JPEG) — faster on mobile data. */
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

function Card({
  kind,
  title,
  hint,
  capture,
  token,
  ui,
  done,
  onDone,
}: {
  kind: Kind;
  title: string;
  hint: string;
  capture: "user" | "environment";
  token: string;
  ui: Ui;
  done: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setErr(null);
    const blob = await compress(f);
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", blob, `${kind}.jpg`);
    try {
      const r = await fetch(`/m/kyc/${token}/upload`, { method: "POST", body: fd });
      if (r.ok) {
        setPreview(URL.createObjectURL(blob));
        onDone();
      } else {
        setErr(r.status === 410 || r.status === 409 ? ui.expired : ui.failed);
      }
    } catch {
      setErr(ui.failed);
    }
    setBusy(false);
  };

  return (
    <section className="border border-pub-hair bg-pub-card p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-pub-cream">
            {done && <span className="mr-1.5 text-pub-upl">✓</span>}
            {title}
          </h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-pub-muted">{hint}</p>
        </div>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a remote image
          <img src={preview} alt="" className="h-16 w-16 shrink-0 object-cover" />
        )}
      </div>
      <label className={`mt-4 flex h-12 cursor-pointer items-center justify-center text-[15px] font-medium ${done ? "border border-pub-cream text-pub-cream" : "bg-pub-cream text-pub-ink"}`}>
        {busy ? ui.uploading : done ? ui.retake : ui.take}
        <input type="file" accept="image/*" capture={capture} onChange={onPick} disabled={busy} className="sr-only" />
      </label>
      {err && <p role="alert" className="mt-3 text-[13.5px] text-pub-coral">{err}</p>}
    </section>
  );
}

export default function PhoneCapture({ token, ui }: { token: string; ui: Ui }) {
  const [selfie, setSelfie] = useState(false);
  const [id, setId] = useState(false);
  return (
    <div className="mt-6 space-y-4">
      <Card kind="selfie" title={ui.selfie} hint={ui.selfieHint} capture="user" token={token} ui={ui} done={selfie} onDone={() => setSelfie(true)} />
      <Card kind="id" title={ui.id} hint={ui.idHint} capture="environment" token={token} ui={ui} done={id} onDone={() => setId(true)} />
      {selfie && id && (
        <p role="status" className="border-l-2 border-pub-upl pl-3.5 text-[15.5px] leading-relaxed text-pub-cream">
          {ui.done}
        </p>
      )}
    </div>
  );
}
