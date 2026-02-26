"""Vision analysis of game frames using Ollama (local model)."""

import time
from pathlib import Path

import httpx

from .frame_extractor import ExtractedFrame
from .helpers import (
    image_to_base64, load_prompt, build_full_analysis_prompt,
    parse_json_response, error_result,
)

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


def _call_vision(client: OllamaClient, image_path: Path, prompt: str) -> dict:
    """Send an image to Ollama and parse the JSON response."""
    b64 = image_to_base64(image_path)
    text = client.chat(prompt, b64)
    return parse_json_response(text)


def light_scan(client: OllamaClient, frame: ExtractedFrame) -> dict:
    """Run a light scan on a frame to extract round number and phase.

    Returns dict with keys: round, phase, player_hp, confidence
    """
    prompt = load_prompt("light_scan.txt")
    result = _call_vision(client, frame.path, prompt)
    result["timestamp_sec"] = frame.timestamp_sec
    return result


def full_analysis(client: OllamaClient, frame: ExtractedFrame) -> dict:
    """Run full game state analysis on a frame.

    Returns complete game state dict.
    """
    prompt = build_full_analysis_prompt()
    result = _call_vision(client, frame.path, prompt)
    result["timestamp_sec"] = frame.timestamp_sec
    return result


def batch_light_scan(
    client: OllamaClient,
    frames: list[ExtractedFrame],
    on_progress: callable = None,
) -> list[dict]:
    """Run light scan on multiple frames sequentially.

    Failed frames get a placeholder result.
    """
    results = []
    for i, frame in enumerate(frames):
        try:
            result = light_scan(client, frame)
        except Exception as e:
            print(f"  Warning: skipping frame {frame.path.name} ({e})")
            result = error_result(frame, str(e))
            time.sleep(5)
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

    Failed frames get a placeholder result.
    """
    results = []
    for i, frame in enumerate(frames):
        try:
            result = full_analysis(client, frame)
        except Exception as e:
            print(f"  Warning: skipping frame {frame.path.name} ({e})")
            result = error_result(frame, str(e))
            time.sleep(5)
        results.append(result)
        if on_progress:
            on_progress(i, len(frames), result)
    return results
