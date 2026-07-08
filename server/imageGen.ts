/**
 * Image generation via Hugging Face Inference API (FLUX.1-schnell)
 * Pure Node.js — no Python subprocess needed.
 */

const HF_TOKEN = process.env.HF_TOKEN || "";
const HF_API_URL = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2-1";

interface GenerateOptions {
  imageBytes?: Buffer;
  imageMediaType?: string;
  aspectRatio?: string;
  model?: string;
}

export async function generate_image(prompt: string, options: GenerateOptions = {}): Promise<Buffer> {
  if (!HF_TOKEN) {
    throw new Error("HF_TOKEN environment variable is not set");
  }

  const payload = {
    inputs: prompt,
    parameters: {
      num_inference_steps: 4,
    }
  };

  const attempt = async (): Promise<Buffer> => {
    const res = await fetch(HF_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });

    if (res.status === 503) {
      // Model loading — wait and retry
      let wait = 20;
      try {
        const err = await res.json() as { estimated_time?: number };
        wait = Math.min(err.estimated_time ?? 20, 30);
      } catch {}
      console.log(`[imageGen] Model loading, waiting ${wait}s...`);
      await new Promise(r => setTimeout(r, wait * 1000));
      return attempt();
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HF API error ${res.status}: ${body.slice(0, 300)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  };

  console.log(`[imageGen] Generating: "${prompt.slice(0, 60)}..." HF_TOKEN=${HF_TOKEN ? "set" : "MISSING"}`);
  const result = await attempt();
  console.log(`[imageGen] Success: ${result.length} bytes`);
  return result;
}
