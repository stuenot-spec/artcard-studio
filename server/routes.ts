import type { Express } from "express";
import type { Server } from "http";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

// ─── Script resolution ────────────────────────────────────────────────────────
function resolveScript(filename: string): string {
  const candidates = [
    path.join(__dirname, filename),
    path.join(process.cwd(), "server", filename),
    path.join(process.cwd(), "dist", filename),
    "/home/user/workspace/art-visualizer/server/" + filename,
    "/home/user/workspace/art-visualizer/dist/" + filename,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Cannot find ${filename}`);
}

// ─── Session store: maps sessionId → { imageB64, mediaType } ─────────────────
const sessions = new Map<string, { imageB64: string; mediaType: string; ts: number }>();

// Clean up sessions older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of sessions) {
    if (v.ts < cutoff) sessions.delete(k);
  }
}, 60_000);

// ─── Analyze painting — returns painting metadata as JSON ─────────────────────
interface PaintingAnalysis {
  palette: string;
  style: string;
  mood: string;
  dominant_colors: string[];
  size_hint: string;
  wall_color: string;
  interior_style: string;
}

function runAnalyze(imageB64: string, mediaType: string): Promise<PaintingAnalysis> {
  return new Promise((resolve, reject) => {
    const scriptPath = resolveScript("analyze.py");
    const child = spawn("python3", [scriptPath, mediaType], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(imageB64);
    child.stdin.end();
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    const timer = setTimeout(() => { child.kill(); reject(new Error("Analyze timeout 30s")); }, 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`analyze.py exited ${code}: ${Buffer.concat(err).toString().slice(0, 300)}`));
      }
      try {
        const json = JSON.parse(Buffer.concat(out).toString());
        resolve(json);
      } catch (e) {
        reject(new Error(`analyze.py bad JSON: ${Buffer.concat(out).toString().slice(0, 200)}`));
      }
    });
  });
}

// ─── Build dynamic interior prompts based on painting analysis ──────────────
function buildInteriorPrompts(a: PaintingAnalysis): Record<string, { label: string; prompt: string }> {
  const base = `The painting uses ${a.palette} colors. Style: ${a.style} Size: ${a.size_hint}. Mood: ${a.mood}.`;
  const wallDesc = `The walls are painted ${a.wall_color} to complement the artwork.`;

  return {
    apartment: {
      label: "Современная квартира",
      prompt: `Photorealistic interior design scene: a modern Scandinavian living room. ${wallDesc} Light oak floors, minimalist furniture in tones that harmonize with ${a.palette}. The decorative textured relief painting (${a.size_hint}) hangs prominently as the room's focal point in a thin gold metal frame. The room's color scheme is built around the painting's palette of ${a.palette}. Natural daylight. ${a.interior_style} aesthetic. 16:9 composition. No text, no watermarks.`,
    },
    house: {
      label: "Загородный дом",
      prompt: `Photorealistic interior design scene: a warm countryside house living room with wooden ceiling beams and stone fireplace. ${wallDesc} Rustic furniture and textiles in colors that echo the painting's ${a.palette} palette. The decorative textured relief painting (${a.size_hint}) is displayed above the fireplace in a classic wooden frame, lit by warm ambient light. The ${a.mood} mood of the painting is reflected in the room's atmosphere. 16:9 composition. No text, no watermarks.`,
    },
    tennis: {
      label: "Теннисный центр",
      prompt: `Photorealistic interior design scene: an upscale tennis club lounge or VIP reception area. ${wallDesc} Elegant contemporary furniture with accent colors that complement ${a.palette}. The decorative textured relief painting (${a.size_hint}) is mounted as the feature wall centerpiece, subtly lit by ceiling spotlights that highlight its texture. The ${a.mood} artwork adds a sophisticated ${a.interior_style} touch to the sports venue. 16:9 composition. No text, no watermarks.`,
    },
  };
}

// ─── One-shot spawn — fresh process = fresh token every time ─────────────────
function runOneshot(prompt: string, imageB64: string, mediaType: string, aspectRatio = "1:1"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const scriptPath = resolveScript("oneshot.py");
    const child = spawn("python3", [scriptPath, prompt, mediaType, aspectRatio, "nano_banana_pro"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.write(imageB64);
    child.stdin.end();

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));

    const timer = setTimeout(() => { child.kill(); reject(new Error("Timeout 115s")); }, 115_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      const errText = Buffer.concat(err).toString().trim();
      if (errText) console.error(`[oneshot exit=${code}] ${errText.slice(0, 300)}`);
      if (code !== 0) { reject(new Error(`exit ${code}: ${errText.slice(0, 200)}`)); return; }
      const result = Buffer.concat(out);
      if (result.length < 200) { reject(new Error(`empty output (${result.length}b)`)); return; }
      resolve(result);
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
const PROMPTS = [
  {
    id: "white", label: "Нейтральный белый", description: "Чистый профессиональный фон для маркетплейса",
    prompt: "Professional studio product photography of a decorative textured relief artwork painting on canvas. Pure white seamless background. Soft even studio lighting from above, gentle shadow at the base. Full canvas visible with clean edges. Sharp focus on the entire painting surface showing texture detail. Square crop 1:1. No text no watermarks.",
  },
  {
    id: "warm", label: "Тёплый бежевый", description: "Атмосферный фон подчёркивает фактуру",
    prompt: "Artisan editorial studio photo of a decorative textured relief painting on canvas. Warm cream beige seamless paper background. Soft diffused side lighting from left creating gentle shadows in the texture relief to show depth and dimensionality. Slight 3/4 angle to emphasize the three-dimensional texture surface. Full canvas visible. Square crop 1:1. No text no watermarks.",
  },
  {
    id: "dark", label: "Тёмный акцентный", description: "Контрастный фон для люкс-позиционирования",
    prompt: "Premium luxury gallery photo of a decorative textured relief artwork painting on canvas. Deep charcoal dark grey seamless background. Dramatic moody lighting with bright rim light highlighting the peaks of the texture and relief details creating strong contrast. Full canvas visible. Square crop 1:1. No text no watermarks.",
  },
];

// ─── Frame preview prompts (painting rendered with each frame style) ─────────
const FRAME_PROMPTS: Record<string, string> = {
  minimalist:
    "Professional gallery visualization of a decorative textured relief painting displayed in a very thin 10mm matte gold aluminum minimalist frame. The frame is sleek, flat-profile, hairline brushed gold champagne metal. Clean white wall background, soft even studio lighting. Full painting with frame visible, slight drop shadow on the wall. Square 1:1 composition. No text, no watermarks.",
  accent:
    "Gallery visualization of a decorative textured relief painting in a bold 30mm matte black MDF frame. The wide flat black frame creates a strong passe-partout effect that separates the painting from the wall. Light warm grey wall background, focused spot lighting from above that highlights the texture peaks of the painting. Full painting with frame, slight shadow. Square 1:1 composition. No text, no watermarks.",
  classic:
    "Elegant interior visualization of a decorative textured relief painting in a wide 50mm ornate antique gold wooden baguette frame. The frame has classic carved profile details and antiqued patina that echoes the texture of the painting. Warm ivory cream wall background, soft ambient interior lighting. Full painting with frame visible, realistic wall shadow. Square 1:1 composition. No text, no watermarks.",
};

// ─── Interior prompts (painting placed in 3 different room settings) ────────
const INTERIOR_PROMPTS: Record<string, { label: string; prompt: string }> = {
  apartment: {
    label: "Современная квартира",
    prompt: "Photorealistic interior scene: a modern Scandinavian living room with light oak floors, white walls, and a minimalist sofa. The decorative textured relief painting from the reference image is hanging prominently on the main wall, framed in thin gold metal. Natural daylight from a large window. Cozy apartment atmosphere. The painting is the focal point of the composition. 16:9 wide shot. No text, no watermarks.",
  },
  house: {
    label: "Загородный дом",
    prompt: "Photorealistic interior scene: a warm countryside house living room with wooden beams on the ceiling, stone fireplace, and rustic wooden furniture with soft textiles. The decorative textured relief painting from the reference image is displayed above the fireplace in a classic wooden frame, perfectly lit by warm ambient light. Cozy and luxurious home atmosphere. 16:9 wide shot. No text, no watermarks.",
  },
  tennis: {
    label: "Теннисный центр",
    prompt: "Photorealistic interior scene: an upscale tennis club lounge or reception area with green accents, sports trophies, and elegant contemporary furniture. The decorative textured relief painting from the reference image is mounted on the feature wall as premium art decor, subtly lit by ceiling spotlights. The painting adds a sophisticated artistic touch to the sports venue. 16:9 wide shot. No text, no watermarks.",
  },
};

const FRAMES = [
  { id: "minimalist", effect: "Минимализм", effectIcon: "◻", material: "Алюминий", color: "Матовое золото / шампань", width: "8–12 мм", colorHex: "#C9A96E", harmony: "Тонкий профиль не конкурирует с объёмом текстуры. Золотистый оттенок резонирует с тёплыми охристыми пигментами рельефа, создавая единое цветовое поле. Вес рамки визуально «не тянет» картину вниз.", conversion: "Идеально для маркетплейсов: покупатель сразу видит работу, а не рамку. CTR выше у минималистичных подач.", score: 9, tags: ["Wildberries", "Ozon", "Этси"] },
  { id: "accent", effect: "Акцент", effectIcon: "▪", material: "МДФ с покрытием", color: "Матовый чёрный", width: "25–35 мм", colorHex: "#1A1A1A", harmony: "Широкий чёрный профиль создаёт «паспарту-эффект»: между рельефом и краем появляется воздух. Контраст с белой/бежевой фактурой поднимает perceived value. Особенно выигрывает на тёмных и нейтральных фонах карточки.", conversion: "Увеличивает воспринимаемую стоимость на 15–25%. Рекомендуется для ценового сегмента 5 000+ руб.", score: 8, tags: ["Instagram", "Авито-премиум", "Ярмарка Мастеров"] },
  { id: "classic", effect: "Классика", effectIcon: "◈", material: "Багет деревянный", color: "Антик / состаренное золото", width: "40–55 мм", colorHex: "#8B7355", harmony: "Профилированный багет с рельефом повторяет идею объёма самой картины — фактура «диалогирует» с декором рамки. Тёплые древесные тона гармонизируют с природными оттенками текстурных паст. Создаёт законченный интерьерный образ.", conversion: "Подходит для подарочного позиционирования. Включайте фото картины в рамке в интерьере — конверсия gifting-сегмента x2.", score: 7, tags: ["Подарочный сегмент", "Декор интерьера", "Галереи"] },
];

const TIPS = [
  { angle: "Фронт — главное фото", icon: "📐", description: "Строго перпендикулярно, без искажений перспективы. Равные отступы от краёв. Это фото — 1-е на карточке маркетплейса.", conversionImpact: "Критично" },
  { angle: "Диагональ 30–45°", icon: "↗", description: "Повернуть на 30–45° и снять сбоку-сверху. Рельеф «оживает»: видны тени в углублениях. Это фото показывает фактуру как нельзя лучше.", conversionImpact: "Очень высоко" },
  { angle: "Макро-деталь", icon: "🔍", description: "Крупный план фрагмента 15×15 см. Снять вблизи, чтобы были видны пики текстурной пасты, зернистость, слои. Включите боковой свет для теней.", conversionImpact: "Высоко" },
  { angle: "В интерьере", icon: "🏠", description: "Картина на стене над диваном или столом. Покупатель визуализирует у себя дома — это самый сильный продающий кадр для декора.", conversionImpact: "Очень высоко" },
  { angle: "Боковой свет (фактура)", icon: "💡", description: "Настольная лампа или кольцевой свет сбоку под углом 15–30°. Падающий боковой свет создаёт тени в рельефе, визуально утраивая глубину текстуры.", conversionImpact: "Ключевое" },
];

function sseWrite(res: any, event: string, data: object) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ─── Routes ───────────────────────────────────────────────────────────────────
export async function registerRoutes(httpServer: Server, app: Express) {

  // STEP 1: Upload image → get sessionId (fast, plain JSON, no SSE)
  app.post("/api/upload-image", (req, res) => {
    const { image: imageB64, mediaType } = req.body as { image?: string; mediaType?: string };
    if (!imageB64) return res.status(400).json({ error: "Изображение не загружено" });

    const sessionId = crypto.randomBytes(16).toString("hex");
    sessions.set(sessionId, { imageB64, mediaType: mediaType || "image/jpeg", ts: Date.now() });
    console.log(`[upload] session ${sessionId} stored, b64 length=${imageB64.length}`);
    res.json({ sessionId });
  });

  // STEP 2: SSE GET stream — generates 3 cards using stored image
  app.get("/api/stream-cards/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.flushHeaders();
      sseWrite(res, "error", { message: "Сессия не найдена или истекла" });
      res.end();
      return;
    }

    const { imageB64, mediaType } = session;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Heartbeat every 8s — keeps proxy connection alive
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 8_000);

    let done = 0;

    await Promise.all(
      PROMPTS.map(async (p) => {
        try {
          const pngBytes = await runOneshot(p.prompt, imageB64, mediaType);
          const b64 = pngBytes.toString("base64");
          sseWrite(res, "card", { id: p.id, label: p.label, description: p.description, image: `data:image/png;base64,${b64}`, success: true });
        } catch (err: any) {
          console.error(`[stream] card error (${p.id}):`, err?.message?.slice(0, 200));
          sseWrite(res, "card", { id: p.id, label: p.label, description: p.description, image: null, success: false });
        }
        done++;
        if (done === PROMPTS.length) {
          // Keep session alive so user can generate frame previews next
          // TTL cleanup (10 min) handles eventual removal
          sseWrite(res, "done", { total: done });
          clearInterval(heartbeat);
          res.end();
        }
      })
    );
  });

  app.get("/api/frame-recommendations", (_req, res) => {
    res.json({ frames: FRAMES, shootingTips: TIPS });
  });

  // Interior SSE: analyze painting first, then generate 3 adaptive interior scenes
  app.get("/api/stream-interiors/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.flushHeaders();
      sseWrite(res, "error", { message: "Сессия не найдена или истекла. Сначала сгенерируйте студийные карточки" });
      res.end();
      return;
    }

    const { imageB64, mediaType } = session;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 8_000);

    // Step 1: analyze painting
    sseWrite(res, "analyzing", { status: "Анализирую палитру и стиль картины…" });

    let analysis: PaintingAnalysis;
    try {
      analysis = await runAnalyze(imageB64, mediaType);
      console.log("[stream-interiors] analysis:", JSON.stringify(analysis));
      sseWrite(res, "analysis", { ...analysis });
    } catch (err: any) {
      console.error("[stream-interiors] analyze failed:", err?.message?.slice(0, 300));
      // Fallback to neutral defaults if analysis fails
      analysis = {
        palette: "warm ivory, beige, cream, soft gold",
        style: "decorative textured relief painting with organic forms",
        mood: "warm, cozy, artisanal",
        dominant_colors: ["#F5EFE6", "#C9A96E", "#8B7355"],
        size_hint: "medium ~40x40cm",
        wall_color: "warm white",
        interior_style: "contemporary, Scandinavian",
      };
      sseWrite(res, "analysis", { ...analysis, fallback: true });
    }

    // Step 2: build dynamic prompts and generate in parallel
    const dynamicPrompts = buildInteriorPrompts(analysis);
    const interiorIds = ["apartment", "house", "tennis"] as const;
    let done = 0;

    await Promise.all(
      interiorIds.map(async (id) => {
        const { label, prompt } = dynamicPrompts[id];
        try {
          const pngBytes = await runOneshot(prompt, imageB64, mediaType, "16:9");
          const b64 = pngBytes.toString("base64");
          sseWrite(res, "interior", { id, label, image: `data:image/png;base64,${b64}`, success: true });
        } catch (err: any) {
          console.error(`[stream-interiors] error (${id}):`, err?.message?.slice(0, 200));
          sseWrite(res, "interior", { id, label, image: null, success: false });
        }
        done++;
        if (done === interiorIds.length) {
          sseWrite(res, "done", { total: done });
          clearInterval(heartbeat);
          res.end();
        }
      })
    );
  });

  // Frame preview SSE: generates painting-in-frame images for all 3 frame types
  app.get("/api/stream-frames/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.flushHeaders();
      sseWrite(res, "error", { message: "Сессия не найдена или истекла. Сначала сгенерируйте студийные карточки" });
      res.end();
      return;
    }

    const { imageB64, mediaType } = session;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 8_000);

    const frameIds = ["minimalist", "accent", "classic"] as const;
    let done = 0;

    await Promise.all(
      frameIds.map(async (frameId) => {
        const prompt = FRAME_PROMPTS[frameId];
        try {
          const pngBytes = await runOneshot(prompt, imageB64, mediaType);
          const b64 = pngBytes.toString("base64");
          sseWrite(res, "frame", { id: frameId, image: `data:image/png;base64,${b64}`, success: true });
        } catch (err: any) {
          console.error(`[stream-frames] error (${frameId}):`, err?.message?.slice(0, 200));
          sseWrite(res, "frame", { id: frameId, image: null, success: false });
        }
        done++;
        if (done === frameIds.length) {
          sseWrite(res, "done", { total: done });
          clearInterval(heartbeat);
          res.end();
        }
      })
    );
  });
}
