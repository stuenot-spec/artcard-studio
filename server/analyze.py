"""
analyze.py — анализирует фото картины через LLM и возвращает JSON.

Вызов:
  echo '<base64>' | python3 analyze.py [media_type]

Вывод (stdout): JSON
"""

import sys
import json
import asyncio
import os
import re

from pplx.python.sdks.llm_api import (
    Client,
    Conversation,
    Identity,
    ImageBlock,
    ImageSource,
    ImageSourceType,
    LLMAPIClient,
    SamplingParams,
    TextBlock,
)

PROMPT = """Analyze this decorative textured relief painting photo carefully. Return ONLY a JSON object with these exact fields (no markdown, no explanation, no code block):

{
  "palette": "comma-separated list of 4-6 colors visible in the painting",
  "style": "1 sentence: artistic style and technique",
  "mood": "3-4 mood words",
  "dominant_colors": ["#hex1", "#hex2", "#hex3"],
  "size_hint": "one of: small ~30x30cm, medium ~40x40cm, large ~60x60cm, wide ~60x40cm, large wide ~80x60cm",
  "wall_color": "specific wall color name that best complements this painting",
  "interior_style": "2-3 interior design styles that best match"
}"""

async def main():
    media_type = sys.argv[1] if len(sys.argv) > 1 else "image/jpeg"
    image_b64 = sys.stdin.read().strip()

    client = LLMAPIClient()
    convo = Conversation()

    convo.add_user([
        ImageBlock(
            source=ImageSource(
                type=ImageSourceType.BASE64,
                media_type=media_type,
                data=image_b64,
            )
        ),
        TextBlock(text=PROMPT),
    ])

    result = await client.messages.create(
        model="nano_banana_pro",
        convo=convo,
        identity=Identity(client=Client.ASI, use_case="webserver_image_gen"),
        sampling_params=SamplingParams(max_tokens=512),
        # No media_gen_params — text-only response
    )

    # Extract text from response
    text = ""
    for block in (result.content or []):
        if hasattr(block, "text"):
            text += block.text

    # Try to extract JSON from response
    text = text.strip()
    # Remove markdown code blocks if present
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```\s*$", "", text)
    text = text.strip()

    # Validate it's JSON
    parsed = json.loads(text)
    print(json.dumps(parsed, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(main())
