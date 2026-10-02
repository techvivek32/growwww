import { currentUserId } from "@/lib/session";
import { agreementAudio, audioAvailable, audioVersion } from "@/lib/consentAudio";
import type { Lang } from "@/lib/consent";

export const dynamic = "force-dynamic";

const LANGS = new Set<Lang>(["en", "hi", "gu"]);

/**
 * The agreement read aloud, as MP3, for a signed-in user. `?status=1` reports
 * whether recorded audio is available and its version (so the page plays the
 * audio of exactly this text), without generating anything. Byte ranges are
 * served for Safari/iOS, which will not play audio without them.
 */
export async function GET(req: Request, { params }: { params: Promise<{ lang: string }> }) {
  if (!(await currentUserId())) return new Response("Unauthorized", { status: 401 });
  const { lang } = await params;
  if (!LANGS.has(lang as Lang)) return new Response("Bad language", { status: 400 });

  if (new URL(req.url).searchParams.get("status")) {
    const available = audioAvailable();
    return Response.json({ available, v: available ? audioVersion(lang as Lang) : undefined });
  }

  const audio = await agreementAudio(lang as Lang);
  if (!audio) return new Response("Audio not available", { status: 404 });

  const size = audio.length;
  const base = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    // Versioned by ?v=, so a long private cache is safe.
    "Cache-Control": "private, max-age=86400",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
    }
    return new Response(new Uint8Array(audio.subarray(start, end + 1)), {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(audio), { headers: { ...base, "Content-Length": String(size) } });
}
