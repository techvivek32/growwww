"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { acceptConsent, type ConsentState } from "./actions";
import { LogoMark } from "@/components/public/Brand";
import type { ConsentKey, ContractLang, Lang } from "@/lib/consent";

const READ_SECONDS = 120;
const MAX_VIDEO_SECONDS = 35;

/** Which consents must be ticked (mirrors CONSENT_KEYS on the server). */
const REQUIRED: ConsentKey[] = ["account", "identity", "groww", "risk"];
const NO_CONSENTS: Record<ConsentKey, boolean> = {
  account: false, identity: false, groww: false, risk: false, marketing: false, analytics: false,
};

/** Everything read aloud, in order (the server builds the same list). */
function spokenParts(c: ContractLang): string[] {
  return [
    `${c.title}.`,
    c.intro,
    ...c.sections.map((x) => `${x.heading}. ${x.body}`),
    ...c.consents.map((k) => `${k.label}. ${k.text}`),
    c.spokenAck,
  ];
}

/** Short pieces: long utterances are cut off by some browsers' network voices.
 *  Split at sentence ends, then at clause marks, so no piece runs past `max`. */
function chunk(parts: string[], max = 160): string[] {
  const out: string[] = [];
  const pieces = (sentence: string): string[] =>
    sentence.length <= max ? [sentence] : sentence.split(/(?<=[;:,—–])\s+/).flatMap((x) => (x.length <= max ? [x] : x.match(new RegExp(`.{1,${max}}(\\s|$)`, "g")) ?? [x]));
  for (const part of parts) {
    let cur = "";
    for (const sentence of part.split(/(?<=[.!?।])\s+/).flatMap(pieces)) {
      if (cur && (cur + " " + sentence).length > max) {
        out.push(cur);
        cur = sentence;
      } else {
        cur = cur ? `${cur} ${sentence}` : sentence;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(synth.getVoices()), 2000);
    synth.addEventListener("voiceschanged", () => { clearTimeout(timer); resolve(synth.getVoices()); }, { once: true });
  });
}

/** The best installed voice for a language — never a different language. */
function pickVoice(voices: SpeechSynthesisVoice[], tag: string): SpeechSynthesisVoice | null {
  const base = tag.split("-")[0].toLowerCase();
  const fits = voices.filter((v) => v.lang.replace("_", "-").toLowerCase().split("-")[0] === base);
  if (!fits.length) return null;
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang.replace("_", "-").toLowerCase() === tag.toLowerCase() ? 4 : 0) +
    (/natural|online|neural/i.test(v.name) ? 2 : 0) +
    (/google/i.test(v.name) ? 1 : 0);
  return fits.sort((a, b) => score(b) - score(a))[0];
}

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
      className="mt-4 inline-flex h-12 w-full items-center justify-center bg-pub-cream text-[15px] font-semibold text-pub-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
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
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [consents, setConsents] = useState<Record<ConsentKey, boolean>>(NO_CONSENTS);
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
  // read-aloud: a token cancels a running chain; the recorded file, if any
  const speakToken = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInfo = useRef<Partial<Record<Lang, { available: boolean; v?: string }>>>({});
  const [viewed, setViewed] = useState<Lang[]>(["en"]);

  // reading countdown
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [left]);

  // Ask once per language whether recorded audio exists, ahead of the click —
  // iPhones only allow playback that starts directly inside the tap.
  useEffect(() => {
    if (fileInfo.current[lang]) return;
    let alive = true;
    fetch(`/api/consent/audio/${lang}?status=1`)
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((j: { available?: boolean; v?: string }) => {
        if (alive) fileInfo.current[lang] = { available: Boolean(j.available), v: j.v };
      })
      .catch(() => {
        if (alive) fileInfo.current[lang] = { available: false };
      });
    return () => {
      alive = false;
    };
  }, [lang]);

  // stop any speech on unmount / language change
  useEffect(() => {
    const token = speakToken;
    const audio = audioRef;
    return () => {
      token.current++;
      audio.current?.pause();
      audio.current = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [lang]);

  const onScroll = () => {
    const el = boxRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setScrolled(true);
  };

  const stopSpeaking = () => {
    speakToken.current++;
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
    setLoadingAudio(false);
  };

  /** The browser's own voice for this language — never a different language. */
  const speakWithBrowser = async (token: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceErr(t.noVoice);
      return;
    }
    const tag = LANG_META.find((l) => l.code === lang)?.tts ?? "en-IN";
    const voice = pickVoice(await loadVoices(), tag);
    if (token !== speakToken.current) return;
    if (!voice) {
      setVoiceErr(t.noVoice);
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const lines = chunk(spokenParts(c));
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const next = (n: number) => {
      if (watchdog) clearTimeout(watchdog);
      if (token !== speakToken.current) return;
      if (n >= lines.length) {
        setSpeaking(false);
        setListened(true);
        return;
      }
      const u = new SpeechSynthesisUtterance(lines[n]);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.95;
      let done = false;
      const advance = () => {
        if (done) return;
        done = true;
        next(n + 1);
      };
      u.onend = advance;
      u.onerror = () => { if (token === speakToken.current) setSpeaking(false); };
      synth.speak(u);
      // Some browsers drop `end` on long network utterances: move on anyway.
      watchdog = setTimeout(() => { synth.cancel(); advance(); }, 4000 + lines[n].length * 140);
    };
    setSpeaking(true);
    next(0);
  };

  /** 1) the recorded file, when the server has one; 2) the browser's own voice
   *  for this language; 3) otherwise say so — never read it in another voice. */
  const speak = async () => {
    if (speaking || loadingAudio) {
      stopSpeaking();
      return;
    }
    setVoiceErr(null);
    const token = ++speakToken.current;
    const info = fileInfo.current[lang];

    if (info?.available) {
      // Started synchronously inside the click, so iOS allows it.
      const audio = new Audio(`/api/consent/audio/${lang}?v=${info.v ?? ""}`);
      audioRef.current = audio;
      setLoadingAudio(true);
      audio.onplaying = () => { setLoadingAudio(false); setSpeaking(true); };
      audio.onended = () => { setSpeaking(false); setListened(true); };
      const fallback = () => {
        if (token !== speakToken.current) return;
        audioRef.current = null;
        setLoadingAudio(false);
        void speakWithBrowser(token);
      };
      audio.onerror = fallback;
      audio.play().catch(fallback);
      return;
    }
    await speakWithBrowser(token);
  };

  const onFile = (kind: "selfie" | "id") => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(kind);
    setMediaErr(null);
    const ok = await upload(kind, f, f.name);
    setBusy(null);
    if (ok) { if (kind === "selfie") setSelfieUp(true); else setIdUp(true); }
    else setMediaErr(t.uploadFailed);
  };

  const startRec = async () => {
    setMediaErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      streamRef.current = stream;
      if (liveRef.current) { liveRef.current.srcObject = stream; liveRef.current.muted = true; await liveRef.current.play().catch(() => {}); }
      chunksRef.current = [];
      let mr: MediaRecorder;
      try {
        // ~1 Mbps keeps a full-length clip well under the upload limit.
        mr = new MediaRecorder(stream, { videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 64_000 });
      } catch {
        mr = new MediaRecorder(stream);
      }
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
        if (ok) setVideoUp(true); else setMediaErr(t.videoUploadFailed);
      };
      mr.start();
      setRecording(true);
      setRecLeft(MAX_VIDEO_SECONDS);
      autoStopRef.current = setTimeout(() => stopRec(), MAX_VIDEO_SECONDS * 1000);
    } catch {
      setMediaErr(t.camBlocked);
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
  const requiredOk = REQUIRED.every((k) => consents[k]);
  const ready = readReady && mediaReady && requiredOk && name.trim().length >= 3;

  const tile = (done: boolean, label: string) => (
    <span className={done ? "text-up" : "text-ink3"}>{done ? `✓ ${label}` : label}</span>
  );

  return (
    <div>
      <p className="font-plex text-[11px] tracking-[0.12em] text-pub-coral uppercase">Step 02 · {t.consentsTitle}</p>
      <h1 className="pub-display mt-4 text-[clamp(2.4rem,4.5vw,3.4rem)] leading-[1.0] text-pub-cream">{t.before}</h1>
      <p className="mt-3 mb-8 text-[15.5px] leading-relaxed text-pub-muted">{t.subtitle}</p>

      {/* language switcher */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-ink3">{t.language}:</span>
        {LANG_META.map((l) => (
          <button key={l.code} type="button" onClick={() => { stopSpeaking(); setLang(l.code); setListened(false); setVoiceErr(null); setViewed((v) => (v.includes(l.code) ? v : [...v, l.code])); }}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${lang === l.code ? "bg-pub-cream text-pub-ink" : "border border-line text-ink2 hover:bg-surfaceh"}`}>
            {l.label}
          </button>
        ))}
        <button type="button" onClick={speak}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink2 hover:bg-surfaceh sm:ml-auto sm:w-auto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {speaking || loadingAudio ? <><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></> : <path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />}
          </svg>
          {loadingAudio ? t.loadingAudio : speaking ? t.pause : t.listen}
        </button>
      </div>

      {voiceErr && <p role="status" className="mb-3 text-[12.5px] text-down">{voiceErr}</p>}

      {/* whiteboard: the contract on a letterhead */}
      <div ref={boxRef} onScroll={onScroll} tabIndex={0} role="region" aria-label="Agreement text" className="h-[46vh] overflow-y-auto rounded-xl border border-line bg-surface">
        {/* letterhead */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-brand/60 bg-surface px-5 py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center bg-pub-ink">
            <LogoMark tone="art" size={26} />
          </span>
          <div className="min-w-0">
            <p className="pub-display text-[20px] leading-tight text-ink">{c.org.name}</p>
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
          <section className="mt-5 border-t border-line pt-4">
            <h3 className="text-[14px] font-semibold text-ink">{t.consentsTitle}</h3>
            <ol className="mt-2 space-y-2">
              {c.consents.map((k) => (
                <li key={k.key} className="text-[13px] leading-relaxed text-ink2">
                  <span className="font-semibold text-ink">
                    {k.label} · {REQUIRED.includes(k.key) ? t.required : t.optional}
                  </span>{" "}
                  — {k.text}
                </li>
              ))}
            </ol>
          </section>
          <p className="mt-5 border-t border-line pt-4 text-[12px] text-ink3">{t.endOfAgreement}</p>
        </div>
      </div>

      {/* progress cues */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
        {tile(scrolled, scrolled ? t.readDone : t.readToEnd)}
        {tile(listened || timerDone, listened ? t.listenDone : timerDone ? t.timeDone : `${t.timeLeft} — ${left}s`)}
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
              <button type="button" onClick={startRec} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-down px-3.5 text-[12.5px] font-semibold text-pub-ink hover:opacity-90">
                <span className="h-2.5 w-2.5 rounded-full bg-pub-ink" /> {t.startRec}
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
            {busy === "video" && <span className="text-[12px] text-ink3">{t.uploading}</span>}
          </div>
        </div>

        {mediaErr && <p className="mt-2 text-[12px] text-down">{mediaErr}</p>}
      </div>

      {/* sign */}
      <form action={action} className="mt-4">
        <input type="hidden" name="language" value={lang} />
        <input type="hidden" name="viewed" value={viewed.join(",")} />
        {(Object.keys(consents) as ConsentKey[]).map((k) => (
          <input key={k} type="hidden" name={`c_${k}`} value={consents[k] ? "on" : ""} />
        ))}

        <fieldset className="border border-line bg-surface2 px-3.5 py-3">
          <legend className="px-1 text-[12.5px] font-semibold text-ink">{t.consentsTitle}</legend>
          <p className="text-[11.5px] leading-relaxed text-ink3">{t.consentsHint}</p>
          <div className="mt-2 space-y-2.5">
            {c.consents.map((k) => {
              const req = REQUIRED.includes(k.key);
              return (
                <label key={k.key} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={consents[k.key]}
                    onChange={(e) => setConsents((prev) => ({ ...prev, [k.key]: e.target.checked }))}
                    disabled={!readReady}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--c-mark)] disabled:opacity-40"
                  />
                  <span className="text-[12.5px] leading-relaxed text-ink2">
                    <span className={`mr-1.5 font-mono text-[10px] tracking-[0.06em] uppercase ${req ? "text-brandtext" : "text-ink3"}`}>
                      {req ? t.required : t.optional}
                    </span>
                    <strong className="text-ink">{k.label}.</strong> {k.text}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-semibold text-ink2">{t.signature}</span>
          <input name="signature" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.signaturePh} autoComplete="name"
            className="h-11 w-full rounded-lg border border-pub-faint bg-surface px-3.5 text-[14px] text-ink outline-none focus:border-pub-cream" />
        </label>

        {!mediaReady && (readReady) && <p className="mt-2 text-[12px] text-ink3">{t.needMedia}</p>}
        {mediaReady && readReady && !requiredOk && <p className="mt-2 text-[12px] text-ink3">{t.needRequired}</p>}
        {state.error && <p role="alert" className="mt-3 rounded-lg border border-down/30 bg-downsoft px-3 py-2.5 text-[12.5px] text-down">{state.error}</p>}

        <SubmitBtn enabled={ready} label={t.submit} busyLabel={t.submitting} />
        <p className="mt-2 text-[11px] leading-relaxed text-ink3">{t.auditNote}</p>
      </form>
    </div>
  );
}
