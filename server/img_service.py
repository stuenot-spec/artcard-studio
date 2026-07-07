"""
Minimal FastAPI image generation service.
Runs on port 5001. Called by the Express backend via HTTP.
Auto-reinitializes the pplx client on UNAUTHENTICATED errors.
"""
import sys
import os
import asyncio
import base64
import importlib
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import JSONResponse
import uvicorn

# Add this script's directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

app = FastAPI()


async def _do_generate(prompt, image_bytes, media_type, aspect_ratio, model, retry=True):
    """Generate image, reload the module and retry once on auth errors."""
    import generate_image as gi_mod
    importlib.reload(gi_mod)
    from generate_image import generate_image
    try:
        return await generate_image(
            prompt,
            image_bytes=image_bytes,
            image_media_type=media_type,
            aspect_ratio=aspect_ratio,
            model=model,
        )
    except Exception as e:
        err_str = str(e)
        # On token expiry, reload module (re-reads env vars) and retry once
        if retry and ("UNAUTHENTICATED" in err_str or "expired" in err_str or "invalid" in err_str.lower()):
            print("[img_service] Token expired, reinitializing client and retrying...", flush=True)
            await asyncio.sleep(0.5)
            return await _do_generate(prompt, image_bytes, media_type, aspect_ratio, model, retry=False)
        raise


@app.post("/generate")
async def generate(
    prompt: str = Form(...),
    aspect_ratio: str = Form("1:1"),
    model: str = Form("nano_banana_pro"),
    image: UploadFile = File(None),
):
    try:
        image_bytes = None
        media_type = "image/jpeg"
        if image and image.filename:
            image_bytes = await image.read()
            media_type = image.content_type or "image/jpeg"

        result = await _do_generate(prompt, image_bytes, media_type, aspect_ratio, model)
        b64 = base64.b64encode(result).decode()
        return {"image": f"data:image/png;base64,{b64}"}
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[img_service] ERROR: {tb}", flush=True)
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": tb})


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(os.environ.get("IMG_SERVICE_PORT", "5001"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
