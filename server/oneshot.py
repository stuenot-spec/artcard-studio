"""
One-shot image generator.
Each invocation = fresh process = fresh pplx client = fresh token from env.
Eliminates stale/expired session token errors permanently.

Usage:
  echo '<base64_image>' | python3 oneshot.py '<prompt>' [media_type] [aspect_ratio] [model]

Writes PNG bytes to stdout. Errors to stderr. Exit 0=success, 1=failure.
"""
import sys, os, asyncio, base64

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_image import generate_image

async def main():
    if len(sys.argv) < 2:
        print("Usage: oneshot.py <prompt> [media_type] [aspect_ratio] [model]", file=sys.stderr)
        sys.exit(1)

    prompt      = sys.argv[1]
    media_type  = sys.argv[2] if len(sys.argv) > 2 else "image/jpeg"
    aspect_ratio= sys.argv[3] if len(sys.argv) > 3 else "1:1"
    model       = sys.argv[4] if len(sys.argv) > 4 else "nano_banana_pro"

    image_bytes = None
    if not sys.stdin.isatty():
        raw = sys.stdin.buffer.read().strip()
        if raw:
            image_bytes = base64.b64decode(raw)

    result = await generate_image(
        prompt,
        image_bytes=image_bytes,
        image_media_type=media_type,
        aspect_ratio=aspect_ratio,
        model=model,
    )

    sys.stdout.buffer.write(result)
    sys.stdout.buffer.flush()

asyncio.run(main())
