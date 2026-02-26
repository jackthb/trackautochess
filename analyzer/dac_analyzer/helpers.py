"""Shared helpers for vision analysis backends (Anthropic + Ollama)."""

import base64
import json
from pathlib import Path

from .frame_extractor import ExtractedFrame

PROMPTS_DIR = Path(__file__).parent / "prompts"
DATA_DIR = Path(__file__).parent.parent.parent / "data"


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text()


def load_json(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text())


def image_to_base64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode()


def build_full_analysis_prompt() -> str:
    """Build the full analysis prompt with unit/item data injected."""
    prompt = load_prompt("full_analysis.txt")
    units_data = load_json("units.json")
    items_data = load_json("items.json")

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


def parse_json_response(text: str) -> dict:
    """Strip markdown code fences and parse JSON from a vision model response."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]
        text = text.strip()
    return json.loads(text)


def error_result(frame: ExtractedFrame, error: str) -> dict:
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


def classify_round(round_num: int | None) -> str:
    """Classify a round into early/mid/late game."""
    if round_num is None:
        return "unknown"
    if round_num <= 10:
        return "early"
    if round_num <= 25:
        return "mid"
    return "late"


def format_unit(unit: dict) -> str:
    """Format a unit dict for display: 'Name** [Item1, Item2]'."""
    star = "*" * unit.get("star_level", 1)
    items = ""
    if unit.get("items"):
        items = f" [{', '.join(unit['items'])}]"
    return f"{unit['name']}{star}{items}"
