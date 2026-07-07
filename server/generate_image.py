"""
Image generation via Hugging Face Inference API (FLUX.1-schnell)
"""
import asyncio
import base64
import json
import os
import sys
import urllib.request
import urllib.error


HF_TOKEN = os.environ.get("HF_TOKEN", "")
HF_API_URL = "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell"


async def generate_image(
    prompt: str,
    image_bytes: bytes = None,
    image_media_type: str = "image/jpeg",
    aspect_ratio: str = "1:1",
    model: str = None,
) -> bytes:
    """Generate image via HF FLUX.1-schnell. Returns PNG bytes."""

    def _sync_generate():
        headers = {
            "Content-Type": "application/json",
        }
        if HF_TOKEN:
            headers["Authorization"] = f"Bearer {HF_TOKEN}"

        payload = {
            "inputs": prompt,
            "parameters": {
                "num_inference_steps": 4,
            }
        }

        data = json.dumps(payload).encode()
        req = urllib.request.Request(HF_API_URL, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            # Если модель загружается — ждём и повторяем
            if e.code == 503:
                estimated = 20
                try:
                    err_json = json.loads(body)
                    estimated = err_json.get("estimated_time", 20)
                except Exception:
                    pass
                import time
                time.sleep(min(estimated, 30))
                with urllib.request.urlopen(req, timeout=120) as resp:
                    return resp.read()
            raise RuntimeError(f"HF API error {e.code}: {body[:300]}")

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_generate)


# CLI mode — используется из Node.js через subprocess
if __name__ == "__main__":
    prompt = sys.argv[1] if len(sys.argv) > 1 else "studio photo"
    result = asyncio.run(generate_image(prompt))
    sys.stdout.buffer.write(result)
