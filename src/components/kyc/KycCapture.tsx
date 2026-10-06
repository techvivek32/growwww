"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { BLINKS_NEEDED, initLiveness, progress, stepLiveness, type FaceFrame, type Hint } from "./liveness";
import { idIssue, measure, type QualityIssue } from "./imageQuality";

/**
 * The identity capture, the way banking apps do it:
 *  1. Selfie — live front camera, face in the oval, blink twice; the photo is
 *     taken by itself on a frame with open eyes. A printed photo cannot blink.
 *  2. PAN / Aadhaar — rear camera with a card-shaped frame; the shot is cropped
 *     to the card and checked for blur, darkness and glare before upload.
 *
 * Face detection runs ON THE PHONE (MediaPipe, served from our own server).
 * No video is recorded or sent — only the two final photos are uploaded.
 * If the camera or the face model is unavailable, it falls back to a plain
 * photo, so nobody is locked out; the record then says the check did not run.
 */

export type KycKind = "selfie" | "id";
export type UploadResult = "ok" | "expired" | "failed";
export interface Liveness {
  method: "blink";
  blinks: number;
  passed: boolean;
  ms: number;
}
export type KycUpload = (kind: KycKind, photo: Blob, liveness: Liveness | null) => Promise<UploadResult>;
type Ui = Record<string, string>;

const MODEL = "/mediapipe/face_landmarker.task";
const WASM = "/mediapipe/wasm";
const CARD_RATIO = 85.6 / 54; // ID-1 card: PAN and Aadhaar
const LIVE_TIMEOUT_MS = 30_000;

/* -------------------------------------------------------------- utilities */

let landmarker: Promise<FaceLandmarker> | null = null;
function loadLandmarker(): Promise<FaceLandmarker> {
  landmarker ??= (async () => {
    const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true,
      });
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  })().catch((e) => {
    landmarker = null; // let a later attempt retry
    throw e;
  });
  return landmarker;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

function toFrame(r: FaceLandmarkerResult): FaceFrame {
  const faces = r.faceLandmarks?.length ?? 0;
  if (!faces) return { faces: 0, box: null, blinkL: 0, blinkR: 0 };
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of r.faceLandmarks[0]) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const cats = r.faceBlendshapes?.[0]?.categories ?? [];
  const score = (n: string) => cats.find((c) => c.categoryName === n)?.score ?? 0;
  return { faces, box: { x0, y0, x1, y1 }, blinkL: score("eyeBlinkLeft"), blinkR: score("eyeBlinkRight") };
}

async function openCamera(facing: "user" | "environment"): Promise<MediaStream> {
  const size = facing === "environment" ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, ...size } });
}

function stopStream(s: MediaStream | null) {
  s?.getTracks().forEach((t) => t.stop());
}

/** Draw a region of an image source onto a canvas, long edge capped at `maxEdge`. */
function drawTo(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  c.getContext("2d")?.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

const toJpeg = (c: HTMLCanvasElement) => new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));

/** Up to three tries for a network failure; an expired link is final. */
async function sendWithRetry(upload: KycUpload, kind: KycKind, blob: Blob, live: Liveness | null): Promise<UploadResult> {
  for (let i = 0; i < 3; i++) {
    const r = await upload(kind, blob, live);
    if (r !== "failed") return r;
    await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
  }
  return "failed";
}

/* ------------------------------------------------------------- UI pieces */

const btnMain = "flex h-12 w-full items-center justify-center bg-[#f3efe6] text-[15px] font-semibold text-[#15140f] transition-opacity active:opacity-80 disabled:opacity-50";
const btnLine = "flex h-12 w-full items-center justify-center border border-[#f3efe6]/70 text-[15px] font-medium text-[#f3efe6] active:opacity-80";
const btnLink = "text-[14px] font-medium text-[#f3efe6] underline decoration-[#d9471f] decoration-2 underline-offset-4";

function Viewport({ children, refEl }: { children: ReactNode; refEl?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={refEl} className="relative aspect-[3/4] max-h-[68dvh] w-full overflow-hidden bg-black">
      {children}
    </div>
  );
}

function Spinner() {
  return <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#f3efe6]/30 border-t-[#f3efe6]" aria-hidden="true" />;
}

function Flash({ on }: { on: boolean }) {
  return <div className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-300 ${on ? "opacity-80" : "opacity-0"}`} />;
}

function Message({ tone, children }: { tone: "info" | "ok" | "warn" | "err"; children: ReactNode }) {
  const color = { info: "border-[#a39d8f] text-[#f3efe6]", ok: "border-[#8fd19e] text-[#f3efe6]", warn: "border-[#e9b44c] text-[#f3efe6]", err: "border-[#d9471f] text-[#f3efe6]" }[tone];
  return (
    <p role={tone === "err" ? "alert" : "status"} className={`border-l-2 pl-3 text-[14px] leading-relaxed ${color}`}>
      {children}
    </p>
  );
}

/** Pick a photo from the gallery (or the plain camera) when live capture is unavailable. */
function PickFile({ label, capture, onPick, primary }: { label: string; capture?: "user" | "environment"; onPick: (f: File) => void; primary?: boolean }) {
  return (
    <label className={`${primary ? btnMain : btnLine} cursor-pointer`}>
      {label}
      <input
        type="file"
        accept="image/*"
        capture={capture}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
    </label>
  );
}

async function fileToCanvas(f: File, maxEdge: number): Promise<HTMLCanvasElement | null> {
  try {
    const bmp = await createImageBitmap(f);
    return drawTo(bmp, 0, 0, bmp.width, bmp.height, maxEdge);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ the selfie */

type SelfiePhase = "intro" | "starting" | "live" | "manual" | "preview" | "uploading" | "nocam";

function SelfieStep({ ui, upload, onDone }: { ui: Ui; upload: KycUpload; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lmRef = useRef<FaceLandmarker | null>(null);
  const [phase, setPhase] = useState<SelfiePhase>("intro");
  const [hint, setHint] = useState<Hint>("none");
  const [ring, setRing] = useState(0);
  const [blinks, setBlinks] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [flash, setFlash] = useState(false);
  const [shot, setShot] = useState<{ url: string; blob: Blob; live: Liveness | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);

  useEffect(() => () => stopStream(streamRef.current), []);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);
  // Start fetching the face model while the person reads the instructions.
  useEffect(() => {
    void loadLandmarker().catch(() => undefined);
  }, []);

  const start = async () => {
    setErr(null);
    setTimedOut(false);
    setPhase("starting");
    try {
      const stream = await openCamera("user");
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
    } catch (e) {
      setCamErr((e as DOMException)?.name === "NotAllowedError" ? ui.kycCamDenied : ui.kycCamNone);
      setPhase("nocam");
      return;
    }
    try {
      lmRef.current = await withTimeout(loadLandmarker(), 25_000);
      setAttempt((a) => a + 1);
      setPhase("live");
    } catch {
      // No face model on this phone: still let the person take the selfie.
      setPhase("manual");
    }
  };

  const take = async (live: Liveness | null) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    const c = drawTo(v, 0, 0, v.videoWidth, v.videoHeight, 1280);
    const blob = await toJpeg(c);
    stopStream(streamRef.current);
    streamRef.current = null;
    if (!blob) {
      setErr(ui.phoneFailed);
      setPhase("intro");
      return;
    }
    setShot({ url: URL.createObjectURL(blob), blob, live });
    setPhase("preview");
  };

  // The live check: one face in the oval, two blinks, then the photo on open eyes.
  useEffect(() => {
    if (phase !== "live") return;
    let raf = 0;
    let stopped = false;
    let lastTime = -1;
    let st = initLiveness();
    let lastHint: Hint | null = null;
    let lastRing = -1;
    let lastBlinks = -1;
    const began = performance.now();
    const loop = () => {
      if (stopped) return;
      const v = videoRef.current;
      const lm = lmRef.current;
      if (v && lm && v.readyState >= 2 && v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        const now = performance.now();
        let frame: FaceFrame;
        try {
          frame = toFrame(lm.detectForVideo(v, now));
        } catch {
          frame = { faces: 0, box: null, blinkL: 0, blinkR: 0 };
        }
        const r = stepLiveness(st, frame, now);
        st = r.state;
        if (r.hint !== lastHint) setHint((lastHint = r.hint));
        const p = progress(st, r.hint);
        if (p !== lastRing) setRing((lastRing = p));
        if (st.blinks !== lastBlinks) setBlinks((lastBlinks = st.blinks));
        if (r.capture) {
          stopped = true;
          void take({ method: "blink", blinks: st.blinks, passed: st.blinks >= BLINKS_NEEDED, ms: Math.round(now - began) });
          return;
        }
        if (now - began > LIVE_TIMEOUT_MS) setTimedOut(true);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts per attempt
  }, [phase, attempt]);

  const confirm = async () => {
    if (!shot) return;
    setPhase("uploading");
    setErr(null);
    const r = await sendWithRetry(upload, "selfie", shot.blob, shot.live);
    if (r === "ok") onDone();
    else {
      setErr(r === "expired" ? ui.phoneExpired : ui.phoneFailed);
      setPhase("preview");
    }
  };

  const fromFile = async (f: File) => {
    const c = await fileToCanvas(f, 1280);
    const blob = c ? await toJpeg(c) : null;
    if (!blob) return setErr(ui.phoneFailed);
    setShot({ url: URL.createObjectURL(blob), blob, live: null });
    setPhase("preview");
  };

  const hintText: Record<Hint, string> = {
    none: ui.kycFaceNone,
    many: ui.kycFaceMany,
    far: ui.kycFaceFar,
    near: ui.kycFaceNear,
    center: ui.kycFaceCenter,
    blink: ui.kycBlink,
    blinkOnce: ui.kycBlinkOnce,
    hold: ui.kycHold,
  };
  const placed = hint === "blink" || hint === "blinkOnce" || hint === "hold";
  const ovalColor = placed ? "#8fd19e" : "#f3efe6";
  const showCamera = phase === "starting" || phase === "live" || phase === "manual";

  return (
    <div className="space-y-4">
      {(phase === "intro" || phase === "nocam") && (
        <>
          <div className="flex items-center gap-4 border border-[#f3efe6]/15 p-4">
            <svg viewBox="0 0 48 48" className="h-14 w-14 shrink-0" aria-hidden="true">
              <ellipse cx="24" cy="24" rx="15" ry="19" fill="none" stroke="#f3efe6" strokeWidth="1.6" strokeDasharray="3 3" />
              <path d="M17 21q2.5-2.5 5 0M26 21q2.5-2.5 5 0" fill="none" stroke="#d9471f" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M19 31q5 4 10 0" fill="none" stroke="#f3efe6" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <p className="text-[14.5px] leading-relaxed text-[#f3efe6]">{ui.kycSelfieIntro}</p>
          </div>
          <p className="text-[12.5px] leading-relaxed text-[#a39d8f]">{ui.kycLiveNote}</p>
          {phase === "nocam" ? (
            <>
              {camErr && <Message tone="warn">{camErr}</Message>}
              <PickFile label={ui.kycTakePhoto} capture="user" onPick={fromFile} primary />
            </>
          ) : (
            <button type="button" onClick={start} className={btnMain}>
              {ui.kycStart}
            </button>
          )}
        </>
      )}

      {/* The video stays mounted while the camera runs, so the stream is never re-attached. */}
      <div className={showCamera ? "space-y-4" : "hidden"}>
        <Viewport>
          <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
          {/* the oval: everything outside it is dimmed */}
          <div
            className="absolute left-1/2 top-[45%] w-[64%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] transition-[box-shadow] duration-300"
            style={{ aspectRatio: "3 / 4", boxShadow: "0 0 0 9999px rgba(10,10,8,0.62)" }}
          />
          <svg
            className="pointer-events-none absolute left-1/2 top-[45%] w-[68%] -translate-x-1/2 -translate-y-1/2"
            style={{ aspectRatio: "3 / 4" }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <ellipse cx="50" cy="50" rx="48" ry="48" fill="none" stroke="rgba(243,239,230,0.25)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            <ellipse
              cx="50"
              cy="50"
              rx="48"
              ry="48"
              fill="none"
              stroke={ovalColor}
              strokeWidth="4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pathLength={100}
              strokeDasharray={`${Math.round(ring * 100)} 100`}
              transform="rotate(-90 50 50)"
              className="transition-[stroke-dasharray] duration-300"
            />
          </svg>
          {phase === "live" && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-10 text-center">
              <p className="text-[19px] font-semibold text-[#f3efe6]" aria-live="polite">
                {hintText[hint]}
              </p>
              <p className="mt-2 flex justify-center gap-2" aria-hidden="true">
                {Array.from({ length: BLINKS_NEEDED }, (_, i) => (
                  <span key={i} className={`h-2.5 w-2.5 rounded-full ${blinks > i ? "bg-[#8fd19e]" : "bg-[#f3efe6]/30"}`} />
                ))}
              </p>
            </div>
          )}
          {phase === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 text-[14px] text-[#f3efe6]">
              <Spinner />
              {ui.kycStarting}
            </div>
          )}
          {phase === "manual" && (
            <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-10 text-center text-[14px] text-[#f3efe6]">
              {ui.kycManual}
            </p>
          )}
          <Flash on={flash} />
        </Viewport>
        {phase === "manual" && (
          <button type="button" onClick={() => void take(null)} className={btnMain}>
            {ui.kycTakePhoto}
          </button>
        )}
        {phase === "live" && timedOut && (
          <div className="space-y-3">
            <Message tone="warn">{ui.kycTimeout}</Message>
            <button
              type="button"
              onClick={() => {
                setTimedOut(false);
                setAttempt((a) => a + 1);
              }}
              className={btnLine}
            >
              {ui.kycTryAgain}
            </button>
            <button type="button" onClick={() => setPhase("manual")} className={`${btnLink} block`}>
              {ui.kycSkipCheck}
            </button>
          </div>
        )}
      </div>

      {(phase === "preview" || phase === "uploading") && shot && (
        <>
          <div className="relative overflow-hidden bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
            <img src={shot.url} alt="" className="mx-auto max-h-[60dvh] w-full object-contain" />
            {shot.live?.passed && (
              <span className="absolute left-3 top-3 bg-[#15140f]/85 px-2.5 py-1 text-[12.5px] font-medium text-[#8fd19e]">✓ {ui.kycLiveOk}</span>
            )}
          </div>
          {err && <Message tone="err">{err}</Message>}
          <button type="button" onClick={confirm} disabled={phase === "uploading"} className={btnMain}>
            {phase === "uploading" ? (
              <span className="flex items-center gap-2.5">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#15140f]/30 border-t-[#15140f]" />
                {ui.uploading}
              </span>
            ) : (
              ui.kycUseThis
            )}
          </button>
          {phase === "preview" && (
            <button
              type="button"
              onClick={() => {
                setShot(null);
                void start();
              }}
              className={btnLine}
            >
              {ui.phoneRetake}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------- PAN / Aadhaar */

type IdPhase = "intro" | "starting" | "live" | "preview" | "uploading" | "nocam";

function IdStep({ ui, upload, onDone }: { ui: Ui; upload: KycUpload; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<IdPhase>("intro");
  const [flash, setFlash] = useState(false);
  const [shot, setShot] = useState<{ url: string; blob: Blob; issue: QualityIssue } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);

  useEffect(() => () => stopStream(streamRef.current), []);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const start = async () => {
    setErr(null);
    setPhase("starting");
    try {
      const stream = await openCamera("environment");
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
      setPhase("live");
    } catch (e) {
      setCamErr((e as DOMException)?.name === "NotAllowedError" ? ui.kycCamDenied : ui.kycCamNone);
      setPhase("nocam");
    }
  };

  const finish = async (c: HTMLCanvasElement) => {
    const issue = idIssue(measure(c, c.width, c.height));
    const blob = await toJpeg(c);
    if (!blob) return setErr(ui.phoneFailed);
    setShot({ url: URL.createObjectURL(blob), blob, issue });
    setPhase("preview");
  };

  /** Crop the video to the card frame as it appears on screen (object-cover maths). */
  const capture = async () => {
    const v = videoRef.current;
    const box = boxRef.current?.getBoundingClientRect();
    const fr = frameRef.current?.getBoundingClientRect();
    if (!v || !v.videoWidth || !box || !fr) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    const scale = Math.max(box.width / v.videoWidth, box.height / v.videoHeight);
    const offX = (box.width - v.videoWidth * scale) / 2;
    const offY = (box.height - v.videoHeight * scale) / 2;
    const pad = 0.05;
    const fx = fr.left - box.left - fr.width * pad;
    const fy = fr.top - box.top - fr.height * pad;
    const fw = fr.width * (1 + 2 * pad);
    const fh = fr.height * (1 + 2 * pad);
    const sx = Math.max(0, (fx - offX) / scale);
    const sy = Math.max(0, (fy - offY) / scale);
    const sw = Math.min(v.videoWidth - sx, fw / scale);
    const sh = Math.min(v.videoHeight - sy, fh / scale);
    const c = drawTo(v, sx, sy, sw, sh, 1800);
    stopStream(streamRef.current);
    streamRef.current = null;
    await finish(c);
  };

  const fromFile = async (f: File) => {
    stopStream(streamRef.current);
    streamRef.current = null;
    const c = await fileToCanvas(f, 1800);
    if (!c) return setErr(ui.phoneFailed);
    await finish(c);
  };

  const confirm = async () => {
    if (!shot) return;
    setPhase("uploading");
    setErr(null);
    const r = await sendWithRetry(upload, "id", shot.blob, null);
    if (r === "ok") onDone();
    else {
      setErr(r === "expired" ? ui.phoneExpired : ui.phoneFailed);
      setPhase("preview");
    }
  };

  const issueText = shot?.issue === "blurry" ? ui.kycBlurry : shot?.issue === "dark" ? ui.kycDark : shot?.issue === "glare" ? ui.kycGlare : null;
  const showCamera = phase === "starting" || phase === "live";

  return (
    <div className="space-y-4">
      {(phase === "intro" || phase === "nocam") && (
        <>
          <div className="flex items-center gap-4 border border-[#f3efe6]/15 p-4">
            <svg viewBox="0 0 48 48" className="h-14 w-14 shrink-0" aria-hidden="true">
              <rect x="5" y="12" width="38" height="24" rx="2.5" fill="none" stroke="#f3efe6" strokeWidth="1.6" />
              <rect x="9" y="17" width="9" height="11" fill="none" stroke="#d9471f" strokeWidth="1.6" />
              <path d="M22 19h16M22 24h13M22 29h9" stroke="#f3efe6" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <p className="text-[14.5px] leading-relaxed text-[#f3efe6]">{ui.kycCardTip}</p>
          </div>
          {phase === "nocam" ? (
            <>
              {camErr && <Message tone="warn">{camErr}</Message>}
              <PickFile label={ui.kycTakePhoto} capture="environment" onPick={fromFile} primary />
            </>
          ) : (
            <button type="button" onClick={start} className={btnMain}>
              {ui.kycOpenCamera}
            </button>
          )}
          <PickFile label={ui.kycGallery} onPick={fromFile} />
          {err && <Message tone="err">{err}</Message>}
        </>
      )}

      <div className={showCamera ? "space-y-4" : "hidden"}>
        <Viewport refEl={boxRef}>
          <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
          <div
            ref={frameRef}
            className="absolute left-1/2 top-[44%] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-[10px]"
            style={{ aspectRatio: String(CARD_RATIO), boxShadow: "0 0 0 9999px rgba(10,10,8,0.62)" }}
          >
            {(["left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-[10px]", "right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-[10px]", "left-0 bottom-0 border-l-[3px] border-b-[3px] rounded-bl-[10px]", "right-0 bottom-0 border-r-[3px] border-b-[3px] rounded-br-[10px]"] as const).map((c) => (
              <span key={c} className={`absolute h-7 w-7 border-[#f3efe6] ${c}`} />
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-10 text-center">
            <p className="text-[17px] font-semibold text-[#f3efe6]">{ui.kycCardFit}</p>
            <p className="mt-1 text-[13px] text-[#a39d8f]">{ui.kycCardHint}</p>
          </div>
          {phase === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 text-[14px] text-[#f3efe6]">
              <Spinner />
              {ui.kycStarting}
            </div>
          )}
          <Flash on={flash} />
        </Viewport>
        {phase === "live" && (
          <div className="flex items-center justify-between gap-4">
            <label className={`${btnLink} cursor-pointer`}>
              {ui.kycGallery}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void fromFile(f);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void capture()}
              aria-label={ui.kycTakePhoto}
              className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full border-4 border-[#f3efe6] active:scale-95"
            >
              <span className="h-[54px] w-[54px] rounded-full bg-[#f3efe6]" />
            </button>
            <span className="w-[88px]" aria-hidden="true" />
          </div>
        )}
      </div>

      {(phase === "preview" || phase === "uploading") && shot && (
        <>
          <div className="bg-black p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
            <img src={shot.url} alt="" className="mx-auto max-h-[50dvh] w-full object-contain" />
          </div>
          {issueText ? <Message tone="warn">{issueText}</Message> : <Message tone="ok">{ui.kycLooksGood}</Message>}
          {err && <Message tone="err">{err}</Message>}
          {issueText && phase === "preview" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setShot(null);
                  void start();
                }}
                className={btnMain}
              >
                {ui.phoneRetake}
              </button>
              <button type="button" onClick={confirm} className={`${btnLink} block`}>
                {ui.kycUseAnyway}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={confirm} disabled={phase === "uploading"} className={btnMain}>
                {phase === "uploading" ? (
                  <span className="flex items-center gap-2.5">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#15140f]/30 border-t-[#15140f]" />
                    {ui.uploading}
                  </span>
                ) : (
                  ui.kycUseThis
                )}
              </button>
              {phase === "preview" && (
                <button
                  type="button"
                  onClick={() => {
                    setShot(null);
                    void start();
                  }}
                  className={btnLine}
                >
                  {ui.phoneRetake}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- the flow */

export default function KycCapture({
  ui,
  upload,
  initial,
  onUploaded,
}: {
  ui: Ui;
  upload: KycUpload;
  initial: { selfie: boolean; id: boolean };
  onUploaded?: (kind: KycKind) => void;
}) {
  const [done, setDone] = useState(initial);
  const step: KycKind | "done" = !done.selfie ? "selfie" : !done.id ? "id" : "done";
  const mark = (kind: KycKind) => {
    setDone((d) => ({ ...d, [kind]: true }));
    onUploaded?.(kind);
  };

  return (
    <div className="bg-[#15140f] p-4 text-[#f3efe6] sm:p-5">
      <ol className="mb-5 grid grid-cols-2 gap-2" aria-label={ui.kycSteps}>
        {(["selfie", "id"] as const).map((k, i) => {
          const isDone = done[k];
          const active = step === k;
          return (
            <li key={k} className={`border-t-2 pt-2 ${isDone ? "border-[#8fd19e]" : active ? "border-[#f3efe6]" : "border-[#f3efe6]/20"}`}>
              <p className="font-mono text-[10.5px] tracking-[0.12em] text-[#a39d8f] uppercase">
                {i + 1} / 2 {isDone && <span className="text-[#8fd19e]">✓</span>}
              </p>
              <p className={`mt-0.5 text-[14px] font-semibold ${active || isDone ? "text-[#f3efe6]" : "text-[#6f6a5f]"}`}>{k === "selfie" ? ui.phoneSelfie : ui.phoneId}</p>
            </li>
          );
        })}
      </ol>

      {step === "selfie" && <SelfieStep ui={ui} upload={upload} onDone={() => mark("selfie")} />}
      {step === "id" && <IdStep ui={ui} upload={upload} onDone={() => mark("id")} />}
      {step === "done" && (
        <div className="flex flex-col items-center gap-4 py-8 text-center" role="status">
          <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-[#8fd19e] text-[30px] text-[#8fd19e]">✓</span>
          <p className="max-w-[22rem] text-[16px] leading-relaxed text-[#f3efe6]">{ui.kycAllDone}</p>
          <button type="button" onClick={() => setDone({ selfie: false, id: false })} className={btnLink}>
            {ui.kycRedo}
          </button>
        </div>
      )}
    </div>
  );
}
