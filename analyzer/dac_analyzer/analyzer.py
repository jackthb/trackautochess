"""Vision analysis of game frames using Claude API."""

import json
from pathlib import Path

import anthropic

from .frame_extractor import ExtractedFrame
from .helpers import image_to_base64, load_prompt, build_full_analysis_prompt, parse_json_response

MODEL = "claude-sonnet-4-5-20250929"


def _call_vision(client: anthropic.Anthropic, image_path: Path, prompt: str) -> dict:
    """Send an image to Claude and parse the JSON response."""
    b64 = image_to_base64(image_path)
    suffix = image_path.suffix.lower()
    media_type = "image/png" if suffix == ".png" else "image/jpeg"

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
    )

    return parse_json_response(response.content[0].text)


def light_scan(client: anthropic.Anthropic, frame: ExtractedFrame) -> dict:
    """Run a light scan on a frame to extract round number and phase.

    Returns dict with keys: round, phase, player_hp, confidence
    """
    prompt = load_prompt("light_scan.txt")
    result = _call_vision(client, frame.path, prompt)
    result["timestamp_sec"] = frame.timestamp_sec
    return result


def full_analysis(client: anthropic.Anthropic, frame: ExtractedFrame) -> dict:
    """Run full game state analysis on a frame.

    Returns complete game state dict.
    """
    prompt = build_full_analysis_prompt()
    result = _call_vision(client, frame.path, prompt)
    result["timestamp_sec"] = frame.timestamp_sec
    return result


def batch_light_scan(
    client: anthropic.Anthropic,
    frames: list[ExtractedFrame],
    on_progress: callable = None,
) -> list[dict]:
    """Run light scan on multiple frames sequentially."""
    results = []
    for i, frame in enumerate(frames):
        result = light_scan(client, frame)
        results.append(result)
        if on_progress:
            on_progress(i, len(frames), result)
    return results


def batch_full_analysis(
    client: anthropic.Anthropic,
    frames: list[ExtractedFrame],
    on_progress: callable = None,
) -> list[dict]:
    """Run full analysis on multiple frames sequentially."""
    results = []
    for i, frame in enumerate(frames):
        result = full_analysis(client, frame)
        results.append(result)
        if on_progress:
            on_progress(i, len(frames), result)
    return results
