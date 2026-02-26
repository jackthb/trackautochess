"""Output generation for game timeline - JSON and human-readable summary."""

import json
from dataclasses import asdict
from pathlib import Path

from .helpers import classify_round as _classify_round, format_unit as _format_unit
from .timeline import GameTimeline


def save_json(timeline: GameTimeline, output_path: Path) -> None:
    """Save the full game timeline as JSON."""

    def _serialize(obj):
        if hasattr(obj, "__dataclass_fields__"):
            return asdict(obj)
        if isinstance(obj, set):
            return list(obj)
        if isinstance(obj, Path):
            return str(obj)
        raise TypeError(f"Cannot serialize {type(obj)}")

    data = {
        "frames": timeline.frames,
        "events": [asdict(e) for e in timeline.events],
        "round_transitions": timeline.round_transitions,
        "summary": {
            "first_round": timeline.first_round,
            "last_round": timeline.last_round,
            "total_frames": len(timeline.frames),
            "total_events": len(timeline.events),
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2, default=_serialize))


def _get_final_comp(timeline: GameTimeline) -> dict:
    """Extract the final board composition from the last valid frame."""
    for frame in reversed(timeline.frames):
        if frame.get("board_units"):
            return {
                "units": frame["board_units"],
                "synergies": frame.get("active_synergies", []),
                "hp": frame.get("player_hp"),
                "level": frame.get("level"),
            }
    return {}


def generate_summary(timeline: GameTimeline) -> str:
    """Generate a human-readable game summary."""
    lines = []

    # Header
    final_comp = _get_final_comp(timeline)
    synergy_names = [s["name"] for s in final_comp.get("synergies", [])]
    comp_label = " / ".join(synergy_names[:3]) if synergy_names else "Unknown"
    lines.append(f"Game Summary: {comp_label}")
    lines.append("=" * 60)
    lines.append("")

    # Group events by game phase
    early_events = [e for e in timeline.events if _classify_round(e.round) == "early"]
    mid_events = [e for e in timeline.events if _classify_round(e.round) == "mid"]
    late_events = [e for e in timeline.events if _classify_round(e.round) == "late"]

    if early_events:
        lines.append("Early Game (Rounds 1-10):")
        for event in early_events:
            prefix = f"  R{event.round}" if event.round else "  "
            lines.append(f"{prefix}: [{event.event_type}] {event.description}")
        lines.append("")

    if mid_events:
        lines.append("Mid Game (Rounds 11-25):")
        for event in mid_events:
            prefix = f"  R{event.round}" if event.round else "  "
            lines.append(f"{prefix}: [{event.event_type}] {event.description}")
        lines.append("")

    if late_events:
        lines.append("Late Game (Rounds 26+):")
        for event in late_events:
            prefix = f"  R{event.round}" if event.round else "  "
            lines.append(f"{prefix}: [{event.event_type}] {event.description}")
        lines.append("")

    # Final composition
    if final_comp:
        lines.append("Final Composition:")
        if final_comp.get("units"):
            for unit in final_comp["units"]:
                lines.append(f"  - {_format_unit(unit)}")
        if final_comp.get("synergies"):
            syn_strs = [f"{s['name']} ({s['count']})" for s in final_comp["synergies"]]
            lines.append(f"  Synergies: {', '.join(syn_strs)}")
        if final_comp.get("hp") is not None:
            lines.append(f"  Final HP: {final_comp['hp']}")
        lines.append("")

    # Stats
    lines.append(f"Analysis: {len(timeline.frames)} frames, {len(timeline.events)} events detected")
    if timeline.first_round and timeline.last_round:
        lines.append(f"Rounds covered: {timeline.first_round} - {timeline.last_round}")

    return "\n".join(lines)


def save_summary(timeline: GameTimeline, output_path: Path) -> None:
    """Save the human-readable summary to a text file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(generate_summary(timeline))
