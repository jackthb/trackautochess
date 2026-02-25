"""Vision analysis of game frames using Claude API."""

import base64
import json
from pathlib import Path

import anthropic

from .frame_extractor import ExtractedFrame

PROMPTS_DIR = Path(__file__).parent / "prompts"
DATA_DIR = Path(__file__).parent / "data"

MODEL = "claude-sonnet-4-5-20250929"


def _load_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text()


def _load_json(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text())


def _image_to_base64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode()


def _build_full_analysis_prompt() -> str:
    """Build the full analysis prompt with unit/item data injected."""
    prompt = _load_prompt("full_analysis.txt")
    units_data = _load_json("units.json")
    items_data = _load_json("items.json")

    units_list = ", ".join(sorted(units_data["units"].keys()))
    basic_items = ", ".join(items_data["basic_items"])
    combined_items = ", ".join(sorted(items_data["combined_items"].keys()))
    synergies = sorted({s for u in units_data["units"].values() for s in u["synergies"]})
    synergies_list = ", ".join(synergies)

    prompt = prompt.replace("$UNITS_LIST", units_list)
    prompt = prompt.replace("$BASIC_ITEMS", basic_items)
    prompt = prompt.replace("$COMBINED_ITEMS", combined_items)
    prompt = prompt.replace("$SYNERGIES_LIST", synergies_list)
    return prompt


def _call_vision(client: anthropic.Anthropic, image_path: Path, prompt: str) -> dict:
    """Send an image to Claude and parse the JSON response."""
    b64 = _image_to_base64(image_path)
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

    text = response.content[0].text.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]
        text = text.strip()

    return json.loads(text)


def light_scan(client: anthropic.Anthropic, frame: ExtractedFrame) -> dict:
    """Run a light scan on a frame to extract round number and phase.

    Returns dict with keys: round, phase, player_hp, confidence
    """
    prompt = _load_prompt("light_scan.txt")
    result = _call_vision(client, frame.path, prompt)
    result["timestamp_sec"] = frame.timestamp_sec
    return result


def full_analysis(client: anthropic.Anthropic, frame: ExtractedFrame) -> dict:
    """Run full game state analysis on a frame.

    Returns complete game state dict.
    """
    prompt = _build_full_analysis_prompt()
    result = _call_vision(client, frame.path, prompt)
    result["timestamp_sec"] = frame.timestamp_sec
    return result


def batch_light_scan(
    client: anthropic.Anthropic,
    frames: list[ExtractedFrame],
    on_progress: callable = None,
) -> list[dict]:
    """Run light scan on multiple frames sequentially.

    Args:
        client: Anthropic API client.
        frames: List of frames to scan.
        on_progress: Optional callback(index, total, result) for progress reporting.

    Returns:
        List of light scan results.
    """
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
    """Run full analysis on multiple frames sequentially.

    Args:
        client: Anthropic API client.
        frames: List of frames to analyze.
        on_progress: Optional callback(index, total, result) for progress reporting.

    Returns:
        List of full analysis results.
    """
    results = []
    for i, frame in enumerate(frames):
        result = full_analysis(client, frame)
        results.append(result)
        if on_progress:
            on_progress(i, len(frames), result)
    return results
