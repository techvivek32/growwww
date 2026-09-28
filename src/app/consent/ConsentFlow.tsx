"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { acceptConsent, type ConsentState } from "./actions";
import type { ContractLang, Lang } from "@/lib/consent";

const READ_SECONDS = 120;
const MAX_VIDEO_SECONDS = 25;

const LANG_META: { code: Lang; label: string; tts: string }[] = [
  { code: "en", label: "English", tts: "en-IN" },
  { code: "hi", label: "हिन्दी", tts: "hi-IN" },
  { code: "gu", label: "ગુજરાતી", tts: "gu-IN" },
];

async function upload(kind: "selfie" | "id" | "video", file: Blob, name: string): Promise<boolean> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file, name);
  try {
    const r = await fetch("/api/consent/media", { method: "POST", body: fd });
    return r.ok;
  } catch {
    return false;
  }
}

function SubmitBtn({ enabled, label, busyLabel }: { enabled: boolean; label: string; busyLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={!enabled || pending}
      className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
      {pending ? busyLabel : label}
    </button>
  );
}

export default function ConsentFlow({ contract }: { contract: Record<Lang, ContractLang> }) {
  const [state, action] = useActionState<ConsentState, FormData>(acceptConsent, {});
  const [lang, setLang] = useState<Lang>("en");
  const c = contract[lang];
  const t = c.ui;

  const [scrolled, setScrolled] = useState(false);
  const [left, setLeft] = useState(READ_SECONDS);
  const [listened, setListened] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [agree, setAgree] = useState(false);
  const [name, setName] = useState("");

  const [selfieUp, setSelfieUp] = useState(false);
  const [idUp, setIdUp] = useState(false);
  const [videoUp, setVideoUp] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [mediaErr, setMediaErr] = useState<string | null>(null);

  // video recording
  const [recording, setRecording] = useState(false);
  const [recUrl, setRecUrl] = useState<string | null>(null);
  const [recLeft, setRecLeft] = useState(MAX_VIDEO_SECONDS);
  const liveRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);

  // reading countdown
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [left]);

  // stop any speech + recording on unmount / language change
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [lang]);

  const onScroll = () => {
    const el = boxRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setScrolled(true);
  };

  const speak = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setMediaErr("Audio is not supported on this device — please read the agreement.");
      return;
    }
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const text = `${c.title}. ${c.intro} ${c.sections.map((s) => `${s.heading}. ${s.body}`).join(" ")} ${c.spokenAck}`;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG_META.find((l) => l.code === lang)?.tts ?? "en-IN";
    u.rate = 1;
    u.onend = () => { setSpeaking(false); setListened(true); };
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };

  const onFile = (kind: "selfie" | "id") => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(kind);
    setMediaErr(null);
    const ok = await upload(kind, f, f.name);
    setBusy(null);
    if (ok) { if (kind === "selfie") setSelfieUp(true); else setIdUp(true); }
    else setMediaErr("Upload failed — please try again.");
  };

  const startRec = async () => {
    setMediaErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      streamRef.current = stream;
      if (liveRef.current) { liveRef.current.srcObject = stream; liveRef.current.muted = true; await liveRef.current.play().catch(() => {}); }
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      recRef.current = mr;
      mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        if (liveRef.current) liveRef.current.srcObject = null;
        setRecUrl(URL.createObjectURL(blob));
        setBusy("video");
        const ok = await upload("video", blob, "acknowledgement.webm");
        setBusy(null);
        if (ok) setVideoUp(true); else setMediaErr("Video upload failed — please record again.");
      };
      mr.start();
      setRecording(true);
      setRecLeft(MAX_VIDEO_SECONDS);
      autoStopRef.current = setTimeout(() => stopRec(), MAX_VIDEO_SECONDS * 1000);
    } catch {
      setMediaErr("Camera/microphone access was blocked. Allow it, or use a device with a camera.");
    }
  };

  const stopRec = () => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    setRecording(false);
  };

  // countdown display while recording (auto-stop is handled by the timeout above)
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const timerDone = left <= 0;
  const readReady = scrolled && (timerDone || listened);
  const mediaReady = selfieUp && idUp && videoUp;
  const ready = readReady && mediaReady && agree && name.trim().length >= 3;

  const tile = (done: boolean, label: string) => (
    <span className={done ? "text-up" : "text-ink3"}>{done ? `✓ ${label}` : label}</span>
  );

  return (
    <div>
      {/* language switcher */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[12px] font-semibold text-ink3">{t.language}:</span>
        {LANG_META.map((l) => (
          <button key={l.code} type="button" onClick={() => { setLang(l.code); setListened(false); if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); setSpeaking(false); }}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${lang === l.code ? "bg-brand text-white" : "border border-line text-ink2 hover:bg-surfaceh"}`}>
            {l.label}
          </button>
        ))}
        <button type="button" onClick={speak}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink2 hover:bg-surfaceh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {speaking ? <><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></> : <path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />}
          </svg>
          {speaking ? t.pause : t.listen}
        </button>
      </div>

      {/* whiteboard: the contract on a letterhead */}
      <div ref={boxRef} onScroll={onScroll} className="h-[46vh] overflow-y-auto rounded-xl border border-line bg-surface" style={{ boxShadow: "var(--shadow-card)" }}>
        {/* letterhead */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-brand/60 bg-surface px-5 py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: "linear-gradient(135deg, #00d09c 0%, #00a3ff 100%)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16.5 9.5 11l3.5 3.5L20 7" /></svg>
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold tracking-tight text-ink">{c.org.name}</p>
            <p className="truncate text-[11px] text-ink3">{c.org.tagline}</p>
          </div>
          <span className="ml-auto shrink-0 text-right text-[10px] text-ink3">{c.org.meta}</span>
        </div>

        <div className="px-5 py-5">
          <h2 className="text-[17px] font-bold tracking-tight text-ink">{c.title}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink2">{c.intro}</p>
          <div className="mt-4 space-y-4">
            {c.sections.map((s) => (
              <section key={s.heading}>
                <h3 className="text-[14px] font-semibold text-ink">{s.heading}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink2">{s.body}</p>
              </section>
            ))}
          </div>
          <p className="mt-5 border-t border-line pt-4 text-[12px] text-ink3">{t.endOfAgreement}</p>
        </div>
      </div>

      {/* progress cues */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
        {tile(scrolled, scrolled ? t.readDone : t.readToEnd)}
        {tile(listened || timerDone, listened ? t.listenDone : timerDone ? t.listenDone : `${t.timeLeft} — ${left}s`)}
      </div>

      {/* identity capture */}
      <div className="mt-5 rounded-xl border border-line bg-surface p-4" style={{ boxShadow: "var(--shadow-card)" }}>
        <p className="text-[13.5px] font-semibold text-ink">{t.identity}</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink2">{t.selfie} {selfieUp && <span className="text-up">✓</span>}</span>
            <input type="file" accept="image/*" capture="user" onChange={onFile("selfie")} className="block w-full text-[12px] text-ink2 file:mr-2 file:rounded-md file:border-0 file:bg-surface2 file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-ink2" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink2">{t.idphoto} {idUp && <span className="text-up">✓</span>}</span>
            <input type="file" accept="image/*" onChange={onFile("id")} className="block w-full text-[12px] text-ink2 file:mr-2 file:rounded-md file:border-0 file:bg-surface2 file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-ink2" />
          </label>
        </div>

        {/* spoken video */}
        <div className="mt-4">
          <p className="text-[12px] font-medium text-ink2">{t.video} {videoUp && <span className="text-up">✓</span>}</p>
          <p className="mt-0.5 text-[11.5px] text-ink3">{t.videoHint}</p>
          <div className="mt-2 rounded-lg border border-line bg-surface2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
            “{c.spokenAck}”
          </div>
          <div className="mt-2 overflow-hidden rounded-lg bg-black/90" style={{ aspectRatio: "16/10" }}>
            {recUrl ? (
              <video src={recUrl} controls playsInline className="h-full w-full object-contain" />
            ) : (
              <video ref={liveRef} playsInline muted className="h-full w-full object-cover" />
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {!recording && !recUrl && (
              <button type="button" onClick={startRec} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-down px-3.5 text-[12.5px] font-semibold text-white hover:opacity-90">
                <span className="h-2.5 w-2.5 rounded-full bg-white" /> {t.startRec}
              </button>
            )}
            {recording && (
              <button type="button" onClick={stopRec} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3.5 text-[12.5px] font-semibold text-ink hover:bg-surfaceh">
                <span className="h-2.5 w-2.5 rounded-sm bg-down" /> {t.stopRec} · {recLeft}s
              </button>
            )}
            {recUrl && !recording && (
              <button type="button" onClick={() => { setRecUrl(null); setVideoUp(false); startRec(); }} className="inline-flex h-9 items-center rounded-lg border border-line px-3.5 text-[12.5px] font-semibold text-ink2 hover:bg-surfaceh">
                {t.reRec}
              </button>
            )}
            {busy === "video" && <span className="text-[12px] text-ink3">Uploading…</span>}
          </div>
        </div>

        {mediaErr && <p className="mt-2 text-[12px] text-down">{mediaErr}</p>}
      </div>

      {/* sign */}
      <form action={action} className="mt-4">
        <input type="hidden" name="agree" value={agree ? "on" : ""} />
        <input type="hidden" name="language" value={lang} />

        <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface2 px-3.5 py-3">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={!readReady}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--c-brand)] disabled:opacity-40" />
          <span className="text-[12.5px] leading-relaxed text-ink2">{t.agree}</span>
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-semibold text-ink2">{t.signature}</span>
          <input name="signature" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.signaturePh} autoComplete="name"
            className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-[14px] text-ink outline-none focus:border-brand" />
        </label>

        {!mediaReady && (readReady) && <p className="mt-2 text-[12px] text-ink3">{t.needMedia}</p>}
        {state.error && <p role="alert" className="mt-3 rounded-lg border border-down/30 bg-downsoft px-3 py-2.5 text-[12.5px] text-down">{state.error}</p>}

        <SubmitBtn enabled={ready} label={t.submit} busyLabel={t.submitting} />
        <p className="mt-2 text-[11px] leading-relaxed text-ink3">{t.auditNote}</p>
      </form>
    </div>
  );
}
