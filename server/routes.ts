import type { Express } from "express";
import type { Server } from "http";
import crypto from "crypto";
import { generate_image } from "./imageGen.js";
import { analyzePainting } from "./analyzeImage.js";

// ─── Session store ────────────────────────────────────────────────────────────
const sessions = new Map<string, { imageB64: string; mediaType: string; ts: number; paintingDesc?: string }>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of sessions) if (v.ts < cutoff) sessions.delete(k);
}, 60_000);

// ─── Painting analysis (simple heuristic without Python) ─────────────────────
interface PaintingAnalysis {
  palette: string; style: string; mood: string;
  dominant_colors: string[]; size_hint: string;
  wall_color: string; interior_style: string;
}
function defaultAnalysis(): PaintingAnalysis {
  return {
    palette: "warm ivory, beige, cream, soft gold",
    style: "decorative textured relief painting with organic forms",
    mood: "warm, cozy, artisanal",
    dominant_colors: ["#F5EFE6", "#C9A96E", "#8B7355"],
    size_hint: "medium ~40x40cm",
    wall_color: "warm white",
    interior_style: "contemporary, Scandinavian",
  };
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
const PROMPTS = [
  { id: "white", label: "Нейтральный белый", description: "Чистый профессиональный фон для маркетплейса",
    prompt: "Professional studio product photography of a decorative textured relief artwork painting on canvas. Pure white seamless background. Soft even studio lighting from above, gentle shadow at the base. Full canvas visible with clean edges. Sharp focus on the entire painting surface showing texture detail. Square crop 1:1. No text no watermarks." },
  { id: "warm", label: "Тёплый бежевый", description: "Атмосферный фон подчёркивает фактуру",
    prompt: "Artisan editorial studio photo of a decorative textured relief painting on canvas. Warm cream beige seamless paper background. Soft diffused side lighting from left creating gentle shadows in the texture relief to show depth and dimensionality. Slight 3/4 angle to emphasize the three-dimensional texture surface. Full canvas visible. Square crop 1:1. No text no watermarks." },
  { id: "dark", label: "Тёмный акцентный", description: "Контрастный фон для люкс-позиционирования",
    prompt: "Premium luxury gallery photo of a decorative textured relief artwork painting on canvas. Deep charcoal dark grey seamless background. Dramatic moody lighting with bright rim light highlighting the peaks of the texture and relief details creating strong contrast. Full canvas visible. Square crop 1:1. No text no watermarks." },
];

const FRAME_PROMPTS: Record<string, string> = {
  minimalist: "Professional gallery visualization of a decorative textured relief painting displayed in a very thin 10mm matte gold aluminum minimalist frame. The frame is sleek, flat-profile, hairline brushed gold champagne metal. Clean white wall background, soft even studio lighting. Full painting with frame visible, slight drop shadow on the wall. Square 1:1 composition. No text, no watermarks.",
  accent: "Gallery visualization of a decorative textured relief painting in a bold 30mm matte black MDF frame. The wide flat black frame creates a strong passe-partout effect. Light warm grey wall background, focused spot lighting from above. Full painting with frame, slight shadow. Square 1:1 composition. No text, no watermarks.",
  classic: "Elegant interior visualization of a decorative textured relief painting in a wide 50mm ornate antique gold wooden baguette frame with classic carved profile details. Warm ivory cream wall background, soft ambient interior lighting. Full painting with frame visible, realistic wall shadow. Square 1:1 composition. No text, no watermarks.",
};

const INTERIOR_PROMPTS: Record<string, { label: string; prompt: string }> = {
  apartment: { label: "Современная квартира", prompt: "Photorealistic interior scene: a modern Scandinavian living room with light oak floors, white walls, and a minimalist sofa. A decorative textured relief painting is hanging prominently on the main wall in a thin gold metal frame. Natural daylight. The painting is the focal point. 16:9 wide shot. No text, no watermarks." },
  house: { label: "Загородный дом", prompt: "Photorealistic interior scene: a warm countryside house living room with wooden beams, stone fireplace, and rustic furniture. A decorative textured relief painting is displayed above the fireplace in a classic wooden frame, lit by warm ambient light. 16:9 wide shot. No text, no watermarks." },
  tennis: { label: "Теннисный центр", prompt: "Photorealistic interior scene: an upscale tennis club lounge with green accents and elegant contemporary furniture. A decorative textured relief painting is mounted on the feature wall as premium art decor, lit by ceiling spotlights. 16:9 wide shot. No text, no watermarks." },
};

const FRAMES = [
  { id: "minimalist", effect: "Минимализм", effectIcon: "◻", material: "Алюминий", color: "Матовое золото / шампань", width: "8–12 мм", colorHex: "#C9A96E", harmony: "Тонкий профиль не конкурирует с объёмом текстуры.", conversion: "Идеально для маркетплейсов.", score: 9, tags: ["Wildberries", "Ozon", "Этси"] },
  { id: "accent", effect: "Акцент", effectIcon: "▪", material: "МДФ с покрытием", color: "Матовый чёрный", width: "25–35 мм", colorHex: "#1A1A1A", harmony: "Широкий профиль создаёт паспарту-эффект.", conversion: "Увеличивает воспринимаемую стоимость на 15–25%.", score: 8, tags: ["Instagram", "Авито-премиум", "Ярмарка Мастеров"] },
  { id: "classic", effect: "Классика", effectIcon: "◈", material: "Багет деревянный", color: "Антик / состаренное золото", width: "40–55 мм", colorHex: "#8B7355", harmony: "Профилированный багет диалогирует с фактурой картины.", conversion: "Подходит для подарочного позиционирования.", score: 7, tags: ["Подарочный сегмент", "Декор интерьера", "Галереи"] },
];

const TIPS = [
  { angle: "Фронт — главное фото", icon: "📐", description: "Строго перпендикулярно, без искажений перспективы.", conversionImpact: "Критично" },
  { angle: "Диагональ 30–45°", icon: "↗", description: "Рельеф «оживает»: видны тени в углублениях.", conversionImpact: "Очень высоко" },
  { angle: "Макро-деталь", icon: "🔍", description: "Крупный план фрагмента 15×15 см с боковым светом.", conversionImpact: "Высоко" },
  { angle: "В интерьере", icon: "🏠", description: "Картина на стене — самый сильный продающий кадр.", conversionImpact: "Очень высоко" },
  { angle: "Боковой свет (фактура)", icon: "💡", description: "Боковой свет под углом 15–30° утраивает глубину текстуры.", conversionImpact: "Ключевое" },
];

function sseWrite(res: any, event: string, data: object) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ─── Dynamic prompt builder ─────────────────────────────────────────────────
function buildCardPrompt(bg: "white" | "warm" | "dark", paintingDesc: string): string {
  const base = `Professional studio product photography of a ${paintingDesc}.`;
  if (bg === "white") {
    return `${base} Pure white seamless paper background. Soft even studio lighting from above, gentle shadow at the base. Full canvas visible with clean edges. Sharp focus on the entire painting surface showing all texture detail and color. Square crop 1:1. Photorealistic. No text, no watermarks.`;
  }
  if (bg === "warm") {
    return `${base} Warm cream beige seamless paper background. Soft diffused side lighting from the left creating gentle shadows in the texture relief to show depth and dimensionality. Slight 3/4 angle to emphasize three-dimensional texture surface. Full canvas visible. Square crop 1:1. Photorealistic. No text, no watermarks.`;
  }
  // dark
  return `${base} Deep charcoal dark grey seamless background. Dramatic moody lighting with bright rim light highlighting the peaks of the texture and relief details creating strong contrast. Full canvas visible. Square crop 1:1. Photorealistic premium gallery look. No text, no watermarks.`;
}

function buildFramePrompt(style: "minimalist" | "accent" | "classic", paintingDesc: string): string {
  const base = `Gallery visualization of a ${paintingDesc}`;
  if (style === "minimalist") {
    return `${base} displayed in a very thin 10mm matte gold aluminum minimalist frame. Sleek flat-profile hairline brushed champagne metal. Clean white wall background, soft even studio lighting. Full painting with frame visible, slight drop shadow. Square 1:1. No text, no watermarks.`;
  }
  if (style === "accent") {
    return `${base} in a bold 30mm matte black MDF frame creating a strong passe-partout effect. Light warm grey wall background, focused spot lighting from above. Full painting with frame, slight shadow. Square 1:1. No text, no watermarks.`;
  }
  return `${base} in a wide 50mm ornate antique gold wooden baguette frame with classic carved profile. Warm ivory cream wall background, soft ambient interior lighting. Full painting with frame visible, realistic wall shadow. Square 1:1. No text, no watermarks.`;
}

function buildInteriorPrompt(scene: "apartment" | "house" | "tennis", paintingDesc: string): string {
  const art = `a ${paintingDesc}`;
  if (scene === "apartment") {
    return `Photorealistic interior scene: modern Scandinavian living room, light oak floors, white walls, minimalist sofa. ${art} hanging prominently on the main wall in a thin gold frame, natural daylight. The painting is the focal point. 16:9 wide shot. No text, no watermarks.`;
  }
  if (scene === "house") {
    return `Photorealistic interior scene: warm countryside house, wooden beams, stone fireplace, rustic furniture. ${art} displayed above the fireplace in a classic wooden frame, warm ambient light. 16:9 wide shot. No text, no watermarks.`;
  }
  return `Photorealistic interior scene: upscale tennis club lounge, green accents, elegant contemporary furniture. ${art} mounted on the feature wall as premium art decor, ceiling spotlights. 16:9 wide shot. No text, no watermarks.`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────
export async function registerRoutes(httpServer: Server, app: Express) {

  app.post("/api/upload-image", async (req, res) => {
    const { image: imageB64, mediaType } = req.body as { image?: string; mediaType?: string };
    if (!imageB64) return res.status(400).json({ error: "Изображение не загружено" });
    const sessionId = crypto.randomBytes(16).toString("hex");

    // Analyze painting colors immediately on upload
    let paintingDesc: string | undefined;
    try {
      const imgBuf = Buffer.from(imageB64, "base64");
      const analysis = await analyzePainting(imgBuf);
      paintingDesc = analysis.promptFragment;
      console.log(`[upload] painting analysis: ${paintingDesc}`);
    } catch (e: any) {
      console.warn(`[upload] color analysis failed: ${e.message} — using default prompts`);
    }

    sessions.set(sessionId, { imageB64, mediaType: mediaType || "image/jpeg", ts: Date.now(), paintingDesc });
    console.log(`[upload] session ${sessionId} stored, b64 length=${imageB64.length}`);
    res.json({ sessionId, paintingDesc });
  });

  app.get("/api/stream-cards/:sessionId", async (req, res) => {
    const session = sessions.get(req.params.sessionId);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    if (!session) { sseWrite(res, "error", { message: "Сессия не найдена" }); res.end(); return; }

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 8_000);
    const paintingDesc = session.paintingDesc || "decorative textured relief painting on canvas with three-dimensional impasto acrylic texture";
    let done = 0;
    await Promise.all(PROMPTS.map(async (p) => {
      try {
        const prompt = buildCardPrompt(p.id as any, paintingDesc);
        const buf = await generate_image(prompt);
        sseWrite(res, "card", { id: p.id, label: p.label, description: p.description, image: `data:image/png;base64,${buf.toString("base64")}`, success: true });
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.error(`[stream-cards] error (${p.id}):`, errMsg.slice(0, 500));
        sseWrite(res, "card", { id: p.id, label: p.label, description: p.description, image: null, success: false, error: errMsg.slice(0, 200) });
      }
      if (++done === PROMPTS.length) { sseWrite(res, "done", { total: done }); clearInterval(heartbeat); res.end(); }
    }));
  });

  app.get("/api/stream-frames/:sessionId", async (req, res) => {
    const session = sessions.get(req.params.sessionId);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    if (!session) { sseWrite(res, "error", { message: "Сессия не найдена" }); res.end(); return; }

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 8_000);
    const paintingDescF = session.paintingDesc || "decorative textured relief painting on canvas with three-dimensional impasto acrylic texture";
    const frameIds = ["minimalist", "accent", "classic"] as const;
    let done = 0;
    await Promise.all(frameIds.map(async (frameId) => {
      try {
        const buf = await generate_image(buildFramePrompt(frameId, paintingDescF));
        sseWrite(res, "frame", { id: frameId, image: `data:image/png;base64,${buf.toString("base64")}`, success: true });
      } catch (err: any) {
        console.error(`[stream-frames] error (${frameId}):`, err?.message?.slice(0, 200));
        sseWrite(res, "frame", { id: frameId, image: null, success: false });
      }
      if (++done === frameIds.length) { sseWrite(res, "done", { total: done }); clearInterval(heartbeat); res.end(); }
    }));
  });

  app.get("/api/stream-interiors/:sessionId", async (req, res) => {
    const session = sessions.get(req.params.sessionId);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    if (!session) { sseWrite(res, "error", { message: "Сессия не найдена" }); res.end(); return; }

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 8_000);
    sseWrite(res, "analyzing", { status: "Анализирую палитру…" });
    const analysis = defaultAnalysis();
    sseWrite(res, "analysis", analysis);

    const paintingDescI = session.paintingDesc || "decorative textured relief painting on canvas with three-dimensional impasto acrylic texture";
    const interiorIds = ["apartment", "house", "tennis"] as const;
    let done = 0;
    await Promise.all(interiorIds.map(async (id) => {
      const label = INTERIOR_PROMPTS[id].label;
      try {
        const buf = await generate_image(buildInteriorPrompt(id, paintingDescI));
        sseWrite(res, "interior", { id, label, image: `data:image/png;base64,${buf.toString("base64")}`, success: true });
      } catch (err: any) {
        console.error(`[stream-interiors] error (${id}):`, err?.message?.slice(0, 200));
        sseWrite(res, "interior", { id, label, image: null, success: false });
      }
      if (++done === interiorIds.length) { sseWrite(res, "done", { total: done }); clearInterval(heartbeat); res.end(); }
    }));
  });

  app.get("/api/test-hf", async (_req, res) => {
    const results: any = { hf_token_set: !!process.env.HF_TOKEN, hf_token_len: (process.env.HF_TOKEN||'').length };
    // Test google
    try {
      const r = await fetch("https://www.google.com", { signal: AbortSignal.timeout(5_000) });
      results.google = r.status;
    } catch(e: any) { results.google_err = e.cause?.message || e.message; }
    // Test HF
    try {
      const r = await fetch("https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell", {
        method: "POST",
        headers: { 
          "Authorization": `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ inputs: "a red circle" }),
        signal: AbortSignal.timeout(30_000),
      });
      results.hf_status = r.status;
      results.hf_content_type = r.headers.get("content-type");
      const body = await r.arrayBuffer();
      results.hf_bytes = body.byteLength;
    } catch(e: any) { results.hf_err = e.cause?.message || e.message; }
    res.json(results);
  });

  app.get("/api/frame-recommendations", (_req, res) => {
    res.json({ frames: FRAMES, shootingTips: TIPS });
  });
}
// Already added
