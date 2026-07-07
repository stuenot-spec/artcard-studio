"""
Python subprocess helper that generates an image using pplx LLM API.
Reads image bytes from stdin (if provided), writes PNG bytes to stdout.
"""
import sys
import os
import asyncio
import argparse

# Add this script's directory to path so generate_image.py can be found
# Works whether script is in server/ or dist/
_script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _script_dir)

from generate_image import generate_image


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--aspect_ratio", default="1:1")
    parser.add_argument("--model", default="gpt_image_2")
    parser.add_argument("--media_type", default=None)
    args = parser.parse_args()

    # Read image bytes from stdin if available
    image_bytes = None
    media_type = args.media_type or "image/png"

    if not sys.stdin.isatty():
        data = sys.stdin.buffer.read()
        if data:
            image_bytes = data

    result = await generate_image(
        args.prompt,
        image_bytes=image_bytes,
        image_media_type=media_type,
        aspect_ratio=args.aspect_ratio,
        model=args.model,
    )

    sys.stdout.buffer.write(result)


if __name__ == "__main__":
    asyncio.run(main())
