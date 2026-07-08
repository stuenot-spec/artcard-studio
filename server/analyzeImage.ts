/**
 * Color-based painting analysis.
 * Uses sharp to extract dominant colors from the uploaded image,
 * then maps them to descriptive names and builds a painting description
 * for use in FLUX generation prompts.
 */

import sharp from "sharp";

interface RGBColor {
  r: number;
  g: number;
  b: number;
  count: number;
}

interface PaintingDescription {
  dominantColors: string[];      // e.g. ["cobalt blue", "white", "yellow"]
  colorHex: string[];            // e.g. ["#1a7fc1", "#ffffff", "#e8e020"]
  brightness: "dark" | "medium" | "light";
  warmth: "warm" | "cool" | "neutral";
  promptFragment: string;        // ready-to-insert into FLUX prompt
}

// Named color lookup — maps quantized RGB to descriptive art names
function rgbToColorName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2 / 255;

  if (lightness > 0.88) return "white";
  if (lightness < 0.12) return "black";

  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.15) {
    if (lightness > 0.65) return "light grey";
    if (lightness < 0.35) return "dark grey";
    return "grey";
  }

  // Hue calculation
  let hue = 0;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  const isLight = lightness > 0.6;
  const isDark = lightness < 0.3;

  if (hue < 15 || hue >= 345) return isDark ? "dark red" : isLight ? "light red" : "red";
  if (hue < 35) return isDark ? "burnt sienna" : isLight ? "peach" : "orange";
  if (hue < 55) return isDark ? "golden brown" : isLight ? "cream yellow" : "yellow";
  if (hue < 75) return isDark ? "olive" : isLight ? "light yellow-green" : "yellow-green";
  if (hue < 150) return isDark ? "dark green" : isLight ? "sage green" : "green";
  if (hue < 165) return isDark ? "teal" : isLight ? "mint" : "teal";
  if (hue < 195) return isDark ? "dark cyan" : isLight ? "light cyan" : "cyan";
  if (hue < 225) return isDark ? "navy blue" : isLight ? "sky blue" : "cerulean blue";
  if (hue < 255) return isDark ? "deep blue" : isLight ? "periwinkle" : "cobalt blue";
  if (hue < 285) return isDark ? "indigo" : isLight ? "lavender" : "violet";
  if (hue < 315) return isDark ? "deep purple" : isLight ? "light purple" : "purple";
  if (hue < 345) return isDark ? "dark magenta" : isLight ? "pink" : "magenta";
  return "red";
}

function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

export async function analyzePainting(imageBuffer: Buffer): Promise<PaintingDescription> {
  // Resize to small thumbnail for fast processing
  const { data, info } = await sharp(imageBuffer)
    .resize(120, 120, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Quantize into color buckets (step=24 for ~10 buckets per channel)
  const STEP = 24;
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();

  for (let i = 0; i < data.length; i += 3) {
    const r = Math.round(data[i] / STEP) * STEP;
    const g = Math.round(data[i + 1] / STEP) * STEP;
    const b = Math.round(data[i + 2] / STEP) * STEP;
    const key = `${r},${g},${b}`;
    const existing = buckets.get(key);
    if (existing) existing.count++;
    else buckets.set(key, { r, g, b, count: 1 });
  }

  // Sort by frequency, take top 6
  const sorted = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const totalPixels = info.width * info.height;

  // Filter out colors with <5% share (noise)
  const significant = sorted.filter(c => c.count / totalPixels > 0.05);
  const top = significant.length > 0 ? significant : sorted.slice(0, 3);

  // Build color names and hex
  const dominantColors = top.map(c => rgbToColorName(c.r, c.g, c.b));
  const colorHex = top.map(c => toHex(c.r, c.g, c.b));

  // Deduplicate color names
  const uniqueColors = [...new Set(dominantColors)].slice(0, 4);

  // Brightness: average lightness across all pixels
  let totalLightness = 0;
  for (let i = 0; i < data.length; i += 3) {
    totalLightness += (Math.max(data[i], data[i + 1], data[i + 2]) + Math.min(data[i], data[i + 1], data[i + 2])) / 2;
  }
  const avgLightness = totalLightness / (data.length / 3) / 255;
  const brightness: "dark" | "medium" | "light" =
    avgLightness > 0.6 ? "light" : avgLightness < 0.35 ? "dark" : "medium";

  // Warmth: compare warm (R+G) vs cool (B) channels
  let warmScore = 0;
  for (let i = 0; i < data.length; i += 3) {
    warmScore += (data[i] + data[i + 1] * 0.5) - data[i + 2];
  }
  const warmth: "warm" | "cool" | "neutral" =
    warmScore > totalPixels * 20 ? "warm" : warmScore < -totalPixels * 20 ? "cool" : "neutral";

  // Build prompt fragment
  const colorList = uniqueColors.join(", ");
  const brightnessDesc = brightness === "light" ? "light-toned" : brightness === "dark" ? "dark-toned" : "medium-toned";
  const warmthDesc = warmth === "warm" ? "with warm earthy tones" : warmth === "cool" ? "with cool blue tones" : "";

  const promptFragment = `${brightnessDesc} textured relief painting on canvas featuring ${colorList}${warmthDesc ? " " + warmthDesc : ""}, three-dimensional acrylic texture with raised impasto surface`;

  return { dominantColors: uniqueColors, colorHex, brightness, warmth, promptFragment };
}
