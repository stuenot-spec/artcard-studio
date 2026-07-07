import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

// __PORT_5000__ is replaced at deploy time; during local dev it stays as-is so we use ""
const API_BASE: string = ("__PORT_5000__" as string).startsWith("__") ? "" : ("__PORT_5000__" as string);

// Download helper — works in iframes and cross-origin contexts where <a download> is blocked
function downloadDataUrl(dataUrl: string, filename: string) {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)?.[1] ?? "image/png";
  const bstr = atob(arr[1]);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
  const blob = new Blob([u8arr], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Types ──────────────────────────────────────────────────────────────────────────────
interface StudioCard { id: string; label: string; description: string; image: string | null; success: boolean; }
interface Frame { id: string; effect: string; effectIcon: string; material: string; color: string; width: string; colorHex: string; harmony: string; conversion: string; score: number; tags: string[]; }
interface ShootingTip { angle: string; icon: string; description: string; conversionImpact: string; }
interface FramePreview { id: string; image: string | null; success: boolean; }
interface InteriorPreview { id: string; label: string; image: string | null; success: boolean; }
interface PaintingAnalysis {
  palette: string; style: string; mood: string;
  dominant_colors: string[]; size_hint: string;
  wall_color: string; interior_style: string; fallback?: boolean;
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36" aria-label="ArtCard Studio">
      <rect x="4" y="4" width="32" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
      <rect x="9" y="9" width="22" height="22" rx="2" fill="currentColor" fillOpacity="0.1" />
      <path d="M14 26 L20 14 L26 26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 22 H24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────
function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  }, [onFile]);
  return (
    <div className={`upload-zone flex flex-col items-center justify-center gap-4 py-16 px-8 text-center ${dragging ? "drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={handleDrop} onClick={() => inputRef.current?.click()} data-testid="upload-zone">
      <input ref={inputRef} type="file" accept="image/*" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} data-testid="file-input" />
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-foreground mb-1">Загрузите фото картины</p>
        <p className="text-sm text-muted-foreground">Перетащите или кликните · JPG, PNG, WebP · до 20 МБ</p>
      </div>
      <Button variant="outline" size="sm" className="mt-2" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Выбрать файл</Button>
    </div>
  );
}

// ─── Score bar ────────────────────────────────────────────────────────────────
function ScoreMeter({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="score-bar flex-1"><div className="score-fill" style={{ width: `${score * 10}%` }} /></div>
      <span className="text-xs font-semibold text-primary">{score}/10</span>
    </div>
  );
}

// ─── Frame Card ───────────────────────────────────────────────────────────────
function FrameCard({ frame, preview, previewLoading }: { frame: Frame; preview?: FramePreview | null; previewLoading?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const effectColors: Record<string, string> = {
    Минимализм: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    Акцент: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
    Классика: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  };
  return (
    <div className="frame-card fade-in" data-testid={`frame-card-${frame.id}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="frame-swatch mt-0.5" style={{ backgroundColor: frame.colorHex }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`badge-effect ${effectColors[frame.effect] || "bg-muted text-muted-foreground"}`}>{frame.effectIcon} {frame.effect}</span>
          </div>
          <p className="font-semibold text-sm text-foreground">{frame.material}</p>
          <p className="text-xs text-muted-foreground">{frame.color} · {frame.width}</p>
        </div>
      </div>
      <ScoreMeter score={frame.score} />

      {/* Frame Preview Image */}
      {(previewLoading || preview) && (
        <div className="mt-4">
          {previewLoading && !preview && (
            <div className="shimmer aspect-square rounded-xl" />
          )}
          {preview && (
            <div className="fade-in">
              {preview.image ? (
                <div className="relative group">
                  <img
                    src={preview.image}
                    alt={`Картина в рамке ${frame.color}`}
                    className="w-full aspect-square object-contain rounded-xl border border-border"
                    data-testid={`frame-preview-img-${frame.id}`}
                  />
                  <button
                    onClick={() => downloadDataUrl(preview.image!, `frame-${frame.id}.png`)}
                    className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-background/90 backdrop-blur-sm border border-border rounded-lg px-2 py-1 flex items-center gap-1 text-xs text-foreground"
                    data-testid={`button-download-frame-${frame.id}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    PNG
                  </button>
                </div>
              ) : (
                <div className="aspect-square rounded-xl border border-border bg-muted flex items-center justify-center text-sm text-muted-foreground">
                  Ошибка генерации
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        <p className="text-sm text-muted-foreground leading-relaxed">{expanded ? frame.harmony : `${frame.harmony.slice(0, 120)}…`}</p>
        {frame.harmony.length > 120 && (
          <button className="text-xs text-primary mt-1 hover:underline" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Свернуть" : "Читать о гармонии"}
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/15">
          <p className="text-xs font-semibold text-primary mb-1">📈 Конверсия</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{frame.conversion}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-3">
        {frame.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
      </div>
    </div>
  );
}

// ─── Tip Card ─────────────────────────────────────────────────────────────────
function TipCard({ tip, index }: { tip: ShootingTip; index: number }) {
  const impactColors: Record<string, string> = {
    Критично: "text-red-600", Ключевое: "text-orange-600", "Очень высоко": "text-amber-600", Высоко: "text-green-600",
  };
  return (
    <div className="tip-card fade-in">
      <div className="step-number">{index + 1}</div>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-semibold text-foreground">{tip.icon} {tip.angle}</p>
          <span className={`text-xs font-semibold ${impactColors[tip.conversionImpact] || "text-muted-foreground"}`}>{tip.conversionImpact}</span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{tip.description}</p>
      </div>
    </div>
  );
}

// ─── Studio Card Preview ──────────────────────────────────────────────────────
const CARD_ORDER = ["white", "warm", "dark"];
const CARD_BG = ["bg-white border border-gray-200", "bg-amber-50 border border-amber-100", "bg-gray-900 border border-gray-700"];

function StudioCardPreview({ card, loading }: { card: StudioCard | null; loading: boolean; index: number }) {
  const idx = card ? CARD_ORDER.indexOf(card.id) : 0;
  const bgClass = CARD_BG[idx] || CARD_BG[0];
  if (loading && !card) {
    return (
      <div>
        <div className="shimmer h-3 w-24 rounded mb-2" />
        <div className={`card-preview aspect-square ${bgClass} shimmer`} />
        <div className="shimmer h-3 w-32 rounded mx-auto mt-2" />
      </div>
    );
  }
  if (!card) return null;
  return (
    <div className="fade-in" data-testid={`studio-card-${card.id}`}>
      <div className="section-label mb-2">{card.label}</div>
      <div className={`card-preview aspect-square ${bgClass}`}>
        {card.image
          ? <img src={card.image} alt={card.label} className="w-full h-full object-contain" />
          : <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm px-4 text-center">Ошибка генерации</div>
        }
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center">{card.description}</p>
      {card.image && (
        <button onClick={() => downloadDataUrl(card.image!, `artcard-${card.id}.png`)}
          className="mt-2 flex items-center justify-center gap-1 text-xs text-primary hover:underline"
          data-testid={`button-download-card-${card.id}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Скачать PNG
        </button>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, StudioCard>>({});
  const [generating, setGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [frameImages, setFrameImages] = useState<Record<string, FramePreview>>({});
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [framesCount, setFramesCount] = useState(0);
  const [interiorImages, setInteriorImages] = useState<Record<string, InteriorPreview>>({});
  const [generatingInteriors, setGeneratingInteriors] = useState(false);
  const [interiorsCount, setInteriorsCount] = useState(0);
  const [paintingAnalysis, setPaintingAnalysis] = useState<PaintingAnalysis | null>(null);
  const [analyzingStatus, setAnalyzingStatus] = useState<string>("");
  const { toast } = useToast();

  const { data: recommendations } = useQuery({ queryKey: ["/api/frame-recommendations"] });

  const handleFile = (file: File) => {
    setUploadedFile(file);
    setCards({});
    setGeneratedCount(0);
    setSessionId(null);
    setFrameImages({});
    setFramesCount(0);
    setInteriorImages({});
    setInteriorsCount(0);
    setPaintingAnalysis(null);
    setAnalyzingStatus("");
    setInteriorImages({});
    setInteriorsCount(0);
    setPaintingAnalysis(null);
    setAnalyzingStatus("");
    setPaintingAnalysis(null);
    setAnalyzingStatus("");
    const url = URL.createObjectURL(file);
    setPreview(url);
  };

  const handleGenerate = async () => {
    if (!uploadedFile || generating) return;

    setGenerating(true);
    setCards({});
    setGeneratedCount(0);
    setSessionId(null);
    setFrameImages({});
    setFramesCount(0);
    setInteriorImages({});
    setInteriorsCount(0);
    setPaintingAnalysis(null);
    setAnalyzingStatus("");

    try {
      // Step 1: Convert to base64
      const arrayBuffer = await uploadedFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);

      // Step 2: Upload image → get sessionId (fast plain JSON POST, no SSE)
      const uploadRes = await fetch(`${API_BASE}/api/upload-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: b64, mediaType: uploadedFile.type || "image/jpeg" }),
      });
      if (!uploadRes.ok) throw new Error(`Upload failed: HTTP ${uploadRes.status}`);
      const { sessionId } = await uploadRes.json();
      setSessionId(sessionId); // save for frame generation

      // Step 3: Open SSE GET stream — proxy handles GET fine, heartbeats keep it alive
      const response = await fetch(`${API_BASE}/api/stream-cards/${sessionId}`);
      if (!response.ok || !response.body) throw new Error(`Stream failed: HTTP ${response.status}`);

      // Read SSE stream line by line
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const msg of messages) {
          if (!msg.trim() || msg.startsWith(": ")) continue;
          const lines = msg.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) data = line.slice(6).trim();
          }
          if (event === "card" && data) {
            try {
              const card: StudioCard = JSON.parse(data);
              setCards((prev) => ({ ...prev, [card.id]: card }));
              setGeneratedCount((n) => n + 1);
            } catch {}
          }
          if (event === "done") {
            toast({ title: "Карточки готовы!", description: "3 варианта студийных карточек сгенерированы." });
          }
          if (event === "error" && data) {
            const errData = JSON.parse(data);
            throw new Error(errData.message || "Ошибка генерации");
          }
        }
      }
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message || "Не удалось сгенерировать карточки", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateFrames = async () => {
    if (!sessionId || generatingFrames) return;

    setGeneratingFrames(true);
    setFrameImages({});
    setFramesCount(0);

    try {
      const response = await fetch(`${API_BASE}/api/stream-frames/${sessionId}`);
      if (!response.ok || !response.body) throw new Error(`Stream failed: HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const msg of messages) {
          if (!msg.trim() || msg.startsWith(": ")) continue;
          const lines = msg.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) data = line.slice(6).trim();
          }
          if (event === "frame" && data) {
            try {
              const fp: FramePreview = JSON.parse(data);
              setFrameImages((prev) => ({ ...prev, [fp.id]: fp }));
              setFramesCount((n) => n + 1);
            } catch {}
          }
          if (event === "done") {
            toast({ title: "Превью готовы!", description: "3 варианта картины в рамках сгенерированы." });
          }
          if (event === "error" && data) {
            const errData = JSON.parse(data);
            throw new Error(errData.message || "Ошибка генерации превью рамок");
          }
        }
      }
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message || "Не удалось сгенерировать превью рамок", variant: "destructive" });
    } finally {
      setGeneratingFrames(false);
    }
  };

  const handleGenerateInteriors = async () => {
    if (!sessionId || generatingInteriors) return;
    setGeneratingInteriors(true);
    setInteriorImages({});
    setInteriorsCount(0);
    setPaintingAnalysis(null);
    setAnalyzingStatus("");
    try {
      const response = await fetch(`${API_BASE}/api/stream-interiors/${sessionId}`);
      if (!response.ok || !response.body) throw new Error(`Stream failed: HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";
        for (const msg of messages) {
          if (!msg.trim() || msg.startsWith(": ")) continue;
          const lines = msg.split("\n");
          let event = "message", data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) data = line.slice(6).trim();
          }
          if (event === "analyzing" && data) {
            try { const d = JSON.parse(data); setAnalyzingStatus(d.status || "Анализирую…"); } catch {}
          }
          if (event === "analysis" && data) {
            try { const d: PaintingAnalysis = JSON.parse(data); setPaintingAnalysis(d); setAnalyzingStatus(""); } catch {}
          }
          if (event === "interior" && data) {
            try {
              const ip: InteriorPreview = JSON.parse(data);
              setInteriorImages((prev) => ({ ...prev, [ip.id]: ip }));
              setInteriorsCount((n) => n + 1);
            } catch {}
          }
          if (event === "done") toast({ title: "Интерьеры готовы!", description: "3 варианта картины в интерьере сгенерированы." });
          if (event === "error" && data) { const e = JSON.parse(data); throw new Error(e.message); }
        }
      }
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message || "Не удалось сгенерировать интерьеры", variant: "destructive" });
    } finally {
      setGeneratingInteriors(false);
    }
  };

  const showResults = generating || generatedCount > 0;
  const allDone = generatedCount === 3;

  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>
      {/* Header */}
      <header className="gradient-header text-white">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <h1 className="text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>ArtCard Studio</h1>
              <p className="text-xs opacity-70">Визуализатор карточек для маркетплейсов</p>
            </div>
          </div>
          <span className="hidden sm:block text-xs opacity-60">для текстурных картин</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Intro */}
        <div className="mb-8 text-center">
          <div className="section-label mb-3">Инструмент для художника</div>
          <h2 className="text-2xl font-bold text-foreground mb-3" style={{ fontFamily: "var(--font-display)" }}>
            Из фото — в продающую карточку
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm leading-relaxed">
            Загрузите фото вашей текстурной работы. AI сгенерирует 3 студийных варианта,
            подберёт рамки с учётом объёма рельефа и даст рекомендации по ракурсам.
          </p>
        </div>

        {/* Upload + Action */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div>
            <div className="section-label mb-3">Шаг 1 — Загрузка фото</div>
            {!preview
              ? <UploadZone onFile={handleFile} />
              : (
                <div className="relative">
                  <img src={preview} alt="Ваша картина" className="w-full aspect-square object-contain rounded-xl border border-border bg-card" />
                  <button className="absolute top-2 right-2 bg-background/90 backdrop-blur-sm border border-border rounded-full w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground"
                    onClick={() => { setPreview(null); setUploadedFile(null); setCards({}); setGeneratedCount(0); setSessionId(null); setFrameImages({}); setFramesCount(0); setInteriorImages({}); setInteriorsCount(0); setPaintingAnalysis(null); setAnalyzingStatus(''); }}>✕</button>
                </div>
              )
            }
          </div>

          <div className="flex flex-col">
            <div className="section-label mb-3">Шаг 2 — Генерация</div>
            <div className="frame-card flex-1 flex flex-col justify-between">
              <div>
                <h3 className="font-semibold text-foreground mb-3" style={{ fontFamily: "var(--font-display)" }}>Что будет создано</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {[["🎨","3 студийных карточки","нейтральный белый, тёплый бежевый, тёмный фон"],
                    ["🖼","3 варианта рамок","с расчётом гармонии и визуального эффекта"],
                    ["📸","5 советов по ракурсам","для максимальной конверсии на маркетплейсе"]
                  ].map(([icon,title,sub]) => (
                    <li key={title as string} className="flex items-start gap-2">
                      <span className="mt-0.5 text-base">{icon}</span>
                      <div><span className="font-medium text-foreground">{title}</span><span className="block text-xs">{sub}</span></div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Progress */}
              {generating && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Генерация карточек…</span>
                    <span>{generatedCount}/3</span>
                  </div>
                  <div className="score-bar"><div className="score-fill transition-all duration-500" style={{ width: `${(generatedCount / 3) * 100}%` }} /></div>
                  <p className="text-xs text-muted-foreground mt-1">Карточки появляются по мере готовности</p>
                </div>
              )}

              <div className="mt-6">
                {!preview && <p className="text-xs text-muted-foreground mb-3 text-center">Загрузите фото картины, чтобы начать</p>}
                <Button className={`w-full ${preview && !generating ? "pulse-ring" : ""}`}
                  disabled={!uploadedFile || generating} onClick={handleGenerate} data-testid="button-generate">
                  {generating
                    ? <span className="flex items-center gap-2">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        Генерирую… ({generatedCount}/3 готово)
                      </span>
                    : "Создать студийные карточки"
                  }
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Results */}
        {showResults && (
          <div className="mb-8 fade-in">
            <Tabs defaultValue="cards">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div className="section-label">Результаты</div>
                <TabsList>
                  <TabsTrigger value="cards">Карточки {generatedCount > 0 && `(${generatedCount}/3)`}</TabsTrigger>
                  <TabsTrigger value="frames">Рамки</TabsTrigger>
                  <TabsTrigger value="tips">Ракурсы</TabsTrigger>
                  <TabsTrigger value="interiors" data-testid="tab-interiors">
                    Интерьер {interiorsCount > 0 ? `(${interiorsCount}/3)` : ""}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="cards">
                <div className="grid sm:grid-cols-3 gap-5">
                  {CARD_ORDER.map((id, i) => (
                    <StudioCardPreview key={id} card={cards[id] ?? null} loading={generating} index={i} />
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="frames">
                {/* Generate frames button */}
                {sessionId && (
                  <div className="mb-5">
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={generatingFrames}
                      onClick={handleGenerateFrames}
                      data-testid="button-generate-frames"
                    >
                      {generatingFrames ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                          </svg>
                          Генерирую превью в рамках… ({framesCount}/3)
                        </span>
                      ) : framesCount > 0 ? (
                        "🖼 Перегенерировать в рамках"
                      ) : (
                        "🖼 Показать картину в рамках"
                      )}
                    </Button>
                    {generatingFrames && (
                      <div className="mt-2">
                        <div className="score-bar">
                          <div className="score-fill transition-all duration-500" style={{ width: `${(framesCount / 3) * 100}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 text-center">Превью появляются по мере готовности</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-4">
                  {recommendations?.frames?.map((f: Frame) => (
                    <FrameCard
                      key={f.id}
                      frame={f}
                      preview={frameImages[f.id] ?? null}
                      previewLoading={generatingFrames && !frameImages[f.id]}
                    />
                  )) ?? [0,1,2].map(i => <div key={i} className="shimmer h-32 rounded-xl" />)}
                </div>
                {recommendations?.frames && (
                  <div className="mt-6 p-4 rounded-xl bg-primary/5 border border-primary/15">
                    <p className="text-sm font-semibold text-foreground mb-2" style={{ fontFamily: "var(--font-display)" }}>Как выбрать рамку под работу?</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Для объёмных текстурных картин ключевой принцип — рамка должна <strong>дополнять</strong>, а не перекрикивать рельеф.
                      Тонкая металлическая рамка «отделяет» работу от стены, широкий чёрный багет создаёт паспарту-эффект,
                      а деревянный антик продолжает природную эстетику текстурных паст.
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="tips">
                <div className="space-y-3">
                  {recommendations?.shootingTips?.map((t: ShootingTip, i: number) => <TipCard key={i} tip={t} index={i} />) ??
                    [0,1,2,3,4].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}
                </div>
                {recommendations?.shootingTips && (
                  <div className="mt-6 p-4 rounded-xl border border-border bg-card">
                    <p className="text-sm font-semibold text-foreground mb-3" style={{ fontFamily: "var(--font-display)" }}>Чеклист карточки товара</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {["Главное фото — строго фронтальное, квадрат 1:1","Второе фото — диагональный ракурс, видна фактура",
                        "Третье фото — макро детали, боковой свет","Четвёртое — в интерьере (над диваном / столом)",
                        "Фото с рамкой, если продаётся в рамке","Указать размер в сантиметрах на фото",
                        "Показать оборотную сторону с подписью","Видео 15 сек: рукой провести по текстуре"
                      ].map((item, i) => (
                        <label key={i} className="flex items-start gap-2 cursor-pointer group text-sm">
                          <input type="checkbox" className="mt-0.5 accent-[hsl(var(--primary))]" />
                          <span className="text-muted-foreground group-has-[:checked]:line-through group-has-[:checked]:opacity-50">{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="interiors">
                {sessionId ? (
                  <div className="mb-5">
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={generatingInteriors}
                      onClick={handleGenerateInteriors}
                      data-testid="button-generate-interiors"
                    >
                      {generatingInteriors ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                          </svg>
                          Генерирую интерьеры… ({interiorsCount}/3)
                        </span>
                      ) : interiorsCount > 0 ? (
                        "🏠 Перегенерировать интерьеры"
                      ) : (
                        "🏠 Показать картину в интерьере"
                      )}
                    </Button>
                    {generatingInteriors && (
                      <div className="mt-2">
                        <div className="score-bar">
                          <div className="score-fill transition-all duration-500" style={{ width: `${(interiorsCount / 3) * 100}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 text-center">Интерьеры появляются по мере готовности</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Сначала сгенерируйте студийные карточки, затем вернитесь сюда
                  </p>
                )}

                {/* Analysis result card */}
                {(analyzingStatus || paintingAnalysis) && (
                  <div className="mb-4 p-4 rounded-xl border border-border bg-muted/30 fade-in">
                    {analyzingStatus && !paintingAnalysis && (
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        {analyzingStatus}
                      </p>
                    )}
                    {paintingAnalysis && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-semibold text-foreground">🎨 Анализ картины{paintingAnalysis.fallback ? " (примерный)" : ""}</p>
                          <div className="flex gap-1">
                            {paintingAnalysis.dominant_colors?.map((c, i) => (
                              <div key={i} className="w-4 h-4 rounded-full border border-border/50" style={{ backgroundColor: c }} title={c} />
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground"><span className="font-medium">Палитра:</span> {paintingAnalysis.palette}</p>
                        <p className="text-xs text-muted-foreground"><span className="font-medium">Стиль:</span> {paintingAnalysis.style}</p>
                        <div className="flex gap-3 flex-wrap">
                          <p className="text-xs text-muted-foreground"><span className="font-medium">Размер:</span> {paintingAnalysis.size_hint}</p>
                          <p className="text-xs text-muted-foreground"><span className="font-medium">Стена:</span> {paintingAnalysis.wall_color}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-5">
                  {generatingInteriors && interiorsCount < 3 &&
                    Array.from({ length: 3 - interiorsCount }).map((_, i) => (
                      <div key={i} className="shimmer aspect-video rounded-xl" />
                    ))
                  }
                  {(["apartment", "house", "tennis"] as const).map((id) => {
                    const ip = interiorImages[id];
                    if (!ip) return null;
                    const labels: Record<string, string> = {
                      apartment: "🏢 Современная квартира",
                      house: "🏡 Загородный дом",
                      tennis: "🎾 Теннисный центр",
                    };
                    return (
                      <div key={id} className="fade-in rounded-xl border border-border overflow-hidden" data-testid={`interior-card-${id}`}>
                        <div className="px-4 py-3 flex items-center justify-between bg-muted/40 border-b border-border">
                          <p className="font-semibold text-sm text-foreground">{labels[id]}</p>
                          {ip.image && (
                            <button
                              onClick={() => downloadDataUrl(ip.image!, `interior-${id}.png`)}
                              className="flex items-center gap-1 text-xs text-primary hover:underline"
                              data-testid={`button-download-interior-${id}`}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              PNG
                            </button>
                          )}
                        </div>
                        {ip.image ? (
                          <img
                            src={ip.image}
                            alt={labels[id]}
                            className="w-full aspect-video object-cover"
                            data-testid={`interior-img-${id}`}
                          />
                        ) : (
                          <div className="aspect-video bg-muted flex items-center justify-center text-sm text-muted-foreground">
                            Ошибка генерации
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Landing tiles */}
        {!showResults && (
          <div className="grid sm:grid-cols-3 gap-4 mt-4">
            {[["🎨","Нейтральный фон","AI помещает картину в профессиональную студийную среду для маркетплейса"],
              ["🖼","Подбор рамок","Три типа рамок с учётом объёма текстурной работы, материала и ценового сегмента"],
              ["📈","Конверсия","Рекомендации по ракурсам и оформлению карточки для повышения кликабельности"]
            ].map(([icon,title,text]) => (
              <div key={title as string} className="frame-card text-center">
                <div className="text-3xl mb-3">{icon}</div>
                <h3 className="font-semibold text-sm text-foreground mb-2" style={{ fontFamily: "var(--font-display)" }}>{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border mt-16 py-6">
        <p className="text-center text-xs text-muted-foreground">
          ArtCard Studio · для авторов текстурных картин · маркетплейс-готовые карточки за минуту
        </p>
      </footer>
    </div>
  );
}
