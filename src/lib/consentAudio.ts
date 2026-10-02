import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spokenParts, type Lang } from "@/lib/consent";

/**
 * Recorded read-aloud of the agreement, so the audio plays on EVERY device —
 * a browser's built-in voices often lack Hindi and almost always lack
 * Gujarati. Generated once per language per agreement text with Azure's
 * official Speech service (neural Indian voices), then cached on disk.
 *
 * Off unless AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are set; the consent
 * page then falls back to the browser's own voice for that language.
 */

const VOICE: Record<Lang, { locale: string; name: string }> = {
  en: { locale: "en-IN", name: "en-IN-NeerjaNeural" },
  hi: { locale: "hi-IN", name: "hi-IN-SwaraNeural" },
  gu: { locale: "gu-IN", name: "gu-IN-DhwaniNeural" },
};

const DIR = process.env.CONSENT_AUDIO_DIR ?? path.join(process.cwd(), "data", "consent-audio");

function config(): { key: string; region: string } | null {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim();
  return key && region ? { key, region } : null;
}

export function audioAvailable(): boolean {
  return config() !== null;
}

const escapeXml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** A short fingerprint of the exact spoken text + voice: a text change gets a new file and URL. */
export function audioVersion(lang: Lang): string {
  return createHash("sha256").update(`${VOICE[lang].name}\n${spokenParts(lang).join("\n")}`).digest("hex").slice(0, 16);
}

function fileFor(lang: Lang): string {
  return path.join(DIR, `${lang}-${audioVersion(lang)}.mp3`);
}

async function synthesizeOnce(cfg: { key: string; region: string }, lang: Lang, text: string): Promise<Buffer> {
  const v = VOICE[lang];
  const ssml = `<speak version="1.0" xml:lang="${v.locale}"><voice name="${v.name}"><prosody rate="-5%">${escapeXml(text)}</prosody><break time="600ms"/></voice></speak>`;
  const res = await fetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": cfg.key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "mnha-financials",
    },
    body: ssml,
  });
  if (!res.ok) throw Object.assign(new Error(`azure tts ${res.status}`), { status: res.status });
  return Buffer.from(await res.arrayBuffer());
}

/** Retry rate limits and server errors with backoff; give up on anything else. */
async function synthesize(cfg: { key: string; region: string }, lang: Lang, text: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await synthesizeOnce(cfg, lang, text);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

/** A failed generation is not retried on every request — wait a while first. */
const failedAt = new Map<string, number>();
const FAIL_COOLDOWN_MS = 5 * 60 * 1000;

const inflight = new Map<string, Promise<Buffer | null>>();

/** The agreement audio for a language, generating it on first request. */
export async function agreementAudio(lang: Lang): Promise<Buffer | null> {
  const cfg = config();
  if (!cfg) return null;
  const parts = spokenParts(lang);
  const file = fileFor(lang);
  try {
    return await readFile(file);
  } catch {
    /* not generated yet */
  }
  const failed = failedAt.get(file);
  if (failed && Date.now() - failed < FAIL_COOLDOWN_MS) return null;
  let job = inflight.get(file);
  if (!job) {
    job = (async () => {
      try {
        // One request per section keeps each well inside Azure's limits; MP3
        // frames concatenate cleanly into one continuous track.
        const chunks: Buffer[] = [];
        for (const part of parts) chunks.push(await synthesize(cfg, lang, part));
        const audio = Buffer.concat(chunks);
        await mkdir(DIR, { recursive: true });
        await writeFile(`${file}.tmp`, audio);
        await rename(`${file}.tmp`, file);
        return audio;
      } catch (e) {
        console.error("[consent-audio]", lang, e instanceof Error ? e.message : e);
        failedAt.set(file, Date.now());
        return null;
      } finally {
        inflight.delete(file);
      }
    })();
    inflight.set(file, job);
  }
  return job;
}
