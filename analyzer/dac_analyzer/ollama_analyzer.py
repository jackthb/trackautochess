"""Vision analysis of game frames using Ollama (local model)."""

import base64
import json
import time
from pathlib import Path

import httpx

from .frame_extractor import ExtractedFrame

PROMPTS_DIR = Path(__file__).parent / "prompts"
DATA_DIR = Path(__file__).parent.parent.parent / "data"

DEFAULT_MODEL = "qwen2.5vl:7b"
DEFAULT_BASE_URL = "http://localhost:11434"


class OllamaClient:
    """Thin client for the Ollama HTTP API."""

    def __init__(self, model: str = DEFAULT_MODEL, base_url: str = DEFAULT_BASE_URL):
        self.model = model
        self.base_url = base_url.rstrip("/")

    def chat(self, prompt: str, image_b64: str) -> str:
        """Send a vision request and return the response text."""
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": [image_b64],
                }
            ],
            "stream": False,
            "options": {"num_ctx": 16384},
        }
        for attempt in range(3):
            try:
                response = httpx.post(url, json=payload, timeout=120.0)
                response.raise_for_status()
                return response.json()["message"]["content"]
            except httpx.ConnectError:
                raise RuntimeError(
                    f"Ollama not found at {self.base_url}. "
                    "Start it with: ollama serve"
                )
            except httpx.HTTPStatusError as e:
                if attempt < 2:
                    wait = 5 * (attempt + 1)
                    print(f"  Ollama error ({e.response.status_code}), retrying in {wait}s...")
                    time.sleep(wait)
                else:
                    raise


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
    by_tier: dict[int, list[str]] = {}
    for name, info in items_data["items"].items():
        by_tier.setdefault(info["tier"], []).append(name)
    items_list = "\n".join(f"Tier {t}: {', '.join(sorted(by_tier[t]))}" for t in sorted(by_tier))
    synergies = sorted({s for u in units_data["units"].values() for s in u["synergies"]})
    synergies_list = ", ".join(synergies)

    prompt = prompt.replace("$UNITS_LIST", units_list)
    prompt = prompt.replace("$ITEMS_LIST", items_list)
    prompt = prompt.replace("$SYNERGIES_LIST", synergies_list)
    return prompt


def _call_vision(client: OllamaClient, image_path: Path, prompt: str) -> dict:
    """Send an image to Ollama and parse the JSON response."""
    b64 = _image_to_base64(image_path)
    text = client.chat(prompt, b64).strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]
        text = text.strip()

    return json.loads(text)


def light_scan(client: OllamaClient, frame: ExtractedFrame) -> dict:
    """Run a light scan on a frame to extract round number and phase.

    Returns dict with keys: round, phase, player_hp, confidence
    """
    prompt = _load_prompt("light_scan.txt")
    result = _call_vision(client, frame.path, prompt)
    result["timestamp_sec"] = frame.timestamp_sec
    return result


def full_analysis(client: OllamaClient, frame: ExtractedFrame) -> dict:
    """Run full game state analysis on a frame.

    Returns complete game state dict.
    """
    prompt = _build_full_analysis_prompt()
    result = _call_vision(client, frame.path, prompt)
    result["timestamp_sec"] = frame.timestamp_sec
    return result


def _error_result(frame: ExtractedFrame, error: str) -> dict:
    """Minimal placeholder result for a frame that failed analysis."""
    return {
        "timestamp_sec": frame.timestamp_sec,
        "round": None,
        "phase": None,
        "board_units": [],
        "active_synergies": [],
        "gold": None,
        "level": None,
        "player_hp": None,
        "_error": error,
    }


def batch_light_scan(
    client: OllamaClient,
    frames: list[ExtractedFrame],
    on_progress: callable = None,
) -> list[dict]:
    """Run light scan on multiple frames sequentially.

    Args:
        client: OllamaClient instance.
        frames: List of frames to scan.
        on_progress: Optional callback(index, total, result) for progress reporting.

    Returns:
        List of light scan results. Failed frames get a placeholder result.
    """
    results = []
    for i, frame in enumerate(frames):
        try:
            result = light_scan(client, frame)
        except Exception as e:
            print(f"  Warning: skipping frame {frame.path.name} ({e})")
            result = _error_result(frame, str(e))
            time.sleep(5)  # Let Ollama's runner restart before next request
        results.append(result)
        if on_progress:
            on_progress(i, len(frames), result)
    return results


def batch_full_analysis(
    client: OllamaClient,
    frames: list[ExtractedFrame],
    on_progress: callable = None,
) -> list[dict]:
    """Run full analysis on multiple frames sequentially.

    Args:
        client: OllamaClient instance.
        frames: List of frames to analyze.
        on_progress: Optional callback(index, total, result) for progress reporting.

    Returns:
        List of full analysis results. Failed frames get a placeholder result.
    """
    results = []
    for i, frame in enumerate(frames):
        try:
            result = full_analysis(client, frame)
        except Exception as e:
            print(f"  Warning: skipping frame {frame.path.name} ({e})")
            result = _error_result(frame, str(e))
            time.sleep(5)  # Let Ollama's runner restart before next request
        results.append(result)
        if on_progress:
            on_progress(i, len(frames), result)
    return results
