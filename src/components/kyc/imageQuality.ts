/**
 * Quick checks on a captured photo, so a blurry or dark ID is caught on the
 * phone — before it is uploaded and someone has to ask for it again.
 *
 * Sharpness is the variance of the Laplacian on a small grey copy: crisp
 * edges (text, card borders) give a high value, a shaken or out-of-focus
 * photo a low one. Brightness is the mean grey level; glare is the share of
 * blown-out pixels.
 */

export interface Quality {
  sharpness: number;
  brightness: number;
  glare: number;
}

export type QualityIssue = "blurry" | "dark" | "glare" | null;

export function measure(source: CanvasImageSource, width: number, height: number): Quality {
  const W = 480;
  const H = Math.max(1, Math.round((height / width) * W));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { sharpness: 999, brightness: 128, glare: 0 };
  ctx.drawImage(source, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  const grey = new Float32Array(W * H);
  let sum = 0;
  let blown = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    grey[j] = g;
    sum += g;
    if (g >= 250) blown++;
  }

  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      const lap = grey[k - W] + grey[k + W] + grey[k - 1] + grey[k + 1] - 4 * grey[k];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const mean = lapSum / Math.max(1, n);
  return {
    sharpness: lapSq / Math.max(1, n) - mean * mean,
    brightness: sum / grey.length,
    glare: blown / grey.length,
  };
}

/** The single most important problem with an ID photo, if any. */
export function idIssue(q: Quality): QualityIssue {
  if (q.brightness < 55) return "dark";
  if (q.glare > 0.12) return "glare";
  if (q.sharpness < 45) return "blurry";
  return null;
}
