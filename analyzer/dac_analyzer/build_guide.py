"""Generate a Markdown build guide from analysis JSON."""

import json
from pathlib import Path

from .helpers import classify_round as _classify_round, format_unit as _format_unit


def _event_label(event_type: str) -> str:
    return {
        "pivot": "[pivot]",
        "power_spike": "[spike]",
        "item_combine": "[item]",
        "economy": "[eco]",
        "level_up": "[level]",
    }.get(event_type, "")


def _get_final_frame(frames: list[dict]) -> dict:
    for frame in reversed(frames):
        if frame.get("board_units"):
            return frame
    return {}


def generate_build_guide(data: dict, title: str = "VOD Analysis") -> str:
    """Generate a Markdown build guide from analysis JSON data.

    Args:
        data: Parsed analysis JSON (produced by dac analyze / output.save_json).
        title: Title string shown in the document header.

    Returns:
        Markdown string.
    """
    frames = data.get("frames", [])
    events = data.get("events", [])
    summary = data.get("summary", {})

    lines = []

    # Header
    first_round = summary.get("first_round", "?")
    last_round = summary.get("last_round", "?")
    lines.append(f"# Build Guide — {title}")
    lines.append("")
    lines.append(
        f"*Rounds {first_round}–{last_round} | "
        f"{len(frames)} frames analyzed | "
        f"{len(events)} events detected*"
    )
    lines.append("")

    # Final composition
    final_frame = _get_final_frame(frames)
    if final_frame:
        lines.append("## Final Composition")
        lines.append("")

        units = final_frame.get("board_units", [])
        if units:
            lines.append("**Units:**")
            for unit in units:
                lines.append(f"- {_format_unit(unit)}")
            lines.append("")

        synergies = final_frame.get("active_synergies", [])
        if synergies:
            lines.append("**Synergies:**")
            for syn in synergies:
                name = syn.get("name", "Unknown")
                count = syn.get("count", "")
                lines.append(f"- {name} ({count})")
            lines.append("")

        if final_frame.get("level") is not None:
            lines.append(f"**Player Level:** {final_frame['level']}")
            lines.append("")

        if final_frame.get("player_hp") is not None:
            lines.append(f"**Final HP:** {final_frame['player_hp']}")
            lines.append("")

    # Build path
    early_events = [e for e in events if _classify_round(e.get("round")) == "early"]
    mid_events = [e for e in events if _classify_round(e.get("round")) == "mid"]
    late_events = [e for e in events if _classify_round(e.get("round")) == "late"]

    lines.append("## Build Path")
    lines.append("")

    for heading, phase_events, label in [
        ("### Early Game (Rounds 1–10)", early_events, "No notable events detected."),
        ("### Mid Game (Rounds 11–25)", mid_events, "No notable events detected."),
        ("### Late Game (Rounds 26+)", late_events, "No notable events detected."),
    ]:
        lines.append(heading)
        lines.append("")
        if phase_events:
            for event in phase_events:
                r = event.get("round", "?")
                desc = event.get("description", "")
                etype = event.get("event_type", "")
                tag = _event_label(etype)
                lines.append(f"- **R{r}** {tag}: {desc}")
        else:
            lines.append(f"*{label}*")
        lines.append("")

    # Key decision points — pivots
    pivot_events = [e for e in events if e.get("event_type") == "pivot"]
    if pivot_events:
        lines.append("## Key Decision Points")
        lines.append("")
        for i, event in enumerate(pivot_events, 1):
            r = event.get("round", "?")
            details = event.get("details", {})
            added = details.get("added", [])
            removed = details.get("removed", [])
            parts = []
            if removed:
                parts.append(f"dropped {', '.join(removed)}")
            if added:
                parts.append(f"picked up {', '.join(added)}")
            desc = "; ".join(parts) if parts else event.get("description", "")
            lines.append(f"{i}. **Round {r}**: {desc}")
        lines.append("")

    # Economy notes
    economy_events = [e for e in events if e.get("event_type") == "economy"]
    if economy_events:
        lines.append("## Economy Notes")
        lines.append("")
        for event in economy_events:
            r = event.get("round", "?")
            desc = event.get("description", "")
            lines.append(f"- **R{r}**: {desc}")
        lines.append("")

    # Power spikes
    spike_events = [e for e in events if e.get("event_type") == "power_spike"]
    if spike_events:
        lines.append("## Power Spikes")
        lines.append("")
        for event in spike_events:
            r = event.get("round", "?")
            desc = event.get("description", "")
            lines.append(f"- **R{r}**: {desc}")
        lines.append("")

    return "\n".join(lines)


def save_build_guide(json_path: Path, output_path: Path = None) -> Path:
    """Generate and save a Markdown build guide from an analysis JSON file.

    Args:
        json_path: Path to the analysis JSON produced by `dac analyze`.
        output_path: Where to write the Markdown. Defaults to
                     dac_buildguide_<stem>.md alongside the JSON.

    Returns:
        Path to the written Markdown file.
    """
    if output_path is None:
        stem = json_path.stem.replace("dac_analysis", "dac_buildguide")
        output_path = json_path.parent / f"{stem}.md"

    data = json.loads(json_path.read_text())
    content = generate_build_guide(data, title=json_path.stem)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content)
    return output_path
