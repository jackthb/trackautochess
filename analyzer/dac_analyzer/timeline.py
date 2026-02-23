"""Assemble analyzed frames into a game timeline and detect key moments."""

from dataclasses import dataclass, field


@dataclass
class GameEvent:
    """A notable event detected in the game timeline."""
    round: int | None
    timestamp_sec: float
    event_type: str  # "pivot", "power_spike", "item_combine", "economy", "level_up"
    description: str
    details: dict = field(default_factory=dict)


@dataclass
class GameTimeline:
    """Complete game timeline assembled from analyzed frames."""
    frames: list[dict]
    events: list[GameEvent]
    round_transitions: list[float]  # timestamps where round changes

    @property
    def first_round(self) -> int | None:
        for f in self.frames:
            if f.get("round") is not None:
                return f["round"]
        return None

    @property
    def last_round(self) -> int | None:
        for f in reversed(self.frames):
            if f.get("round") is not None:
                return f["round"]
        return None


def _get_unit_names(frame: dict) -> set[str]:
    """Extract board unit names from a frame."""
    return {u["name"] for u in frame.get("board_units", [])}


def _get_synergy_names(frame: dict) -> set[str]:
    """Extract active synergy names from a frame."""
    return {s["name"] for s in frame.get("active_synergies", [])}


def _get_star_levels(frame: dict) -> dict[str, int]:
    """Map unit name -> star level for board units."""
    return {u["name"]: u.get("star_level", 1) for u in frame.get("board_units", [])}


def _get_items(frame: dict) -> set[str]:
    """Get all items on the board."""
    items = set(frame.get("items_on_board", []))
    for unit in frame.get("board_units", []):
        items.update(unit.get("items", []))
    return items


def _detect_round_transitions(frames: list[dict]) -> list[float]:
    """Find timestamps where the round number changes."""
    transitions = []
    prev_round = None
    for frame in frames:
        current_round = frame.get("round")
        if current_round is not None and current_round != prev_round:
            if prev_round is not None:
                transitions.append(frame["timestamp_sec"])
            prev_round = current_round
    return transitions


def _detect_pivots(frames: list[dict]) -> list[GameEvent]:
    """Detect when the core synergy composition changes significantly."""
    events = []
    prev_synergies = None

    for frame in frames:
        synergies = _get_synergy_names(frame)
        if not synergies:
            continue

        if prev_synergies is not None:
            added = synergies - prev_synergies
            removed = prev_synergies - synergies
            if len(added) >= 2 or len(removed) >= 2:
                events.append(GameEvent(
                    round=frame.get("round"),
                    timestamp_sec=frame["timestamp_sec"],
                    event_type="pivot",
                    description=f"Synergy shift: dropped {removed or 'none'}, added {added or 'none'}",
                    details={"added": list(added), "removed": list(removed)},
                ))
        prev_synergies = synergies

    return events


def _detect_power_spikes(frames: list[dict]) -> list[GameEvent]:
    """Detect star level upgrades (1->2 or 2->3)."""
    events = []
    prev_stars = {}

    for frame in frames:
        current_stars = _get_star_levels(frame)
        for unit, star in current_stars.items():
            prev = prev_stars.get(unit, 1)
            if star > prev:
                events.append(GameEvent(
                    round=frame.get("round"),
                    timestamp_sec=frame["timestamp_sec"],
                    event_type="power_spike",
                    description=f"{unit} upgraded to {star}-star",
                    details={"unit": unit, "from_star": prev, "to_star": star},
                ))
        prev_stars.update(current_stars)

    return events


def _detect_item_changes(frames: list[dict]) -> list[GameEvent]:
    """Detect new items appearing on the board."""
    events = []
    prev_items: set[str] = set()

    for frame in frames:
        current_items = _get_items(frame)
        new_items = current_items - prev_items
        for item in new_items:
            events.append(GameEvent(
                round=frame.get("round"),
                timestamp_sec=frame["timestamp_sec"],
                event_type="item_combine",
                description=f"New item: {item}",
                details={"item": item},
            ))
        if current_items:
            prev_items = current_items

    return events


def _detect_economy_events(frames: list[dict]) -> list[GameEvent]:
    """Detect notable economy decisions (hitting 50g, big spending sprees)."""
    events = []
    prev_gold = None
    hit_50 = False

    for frame in frames:
        gold = frame.get("gold")
        if gold is None:
            continue

        if not hit_50 and gold >= 50:
            hit_50 = True
            events.append(GameEvent(
                round=frame.get("round"),
                timestamp_sec=frame["timestamp_sec"],
                event_type="economy",
                description=f"Reached 50 gold (interest cap)",
                details={"gold": gold},
            ))

        if prev_gold is not None and prev_gold - gold >= 20:
            events.append(GameEvent(
                round=frame.get("round"),
                timestamp_sec=frame["timestamp_sec"],
                event_type="economy",
                description=f"Big spend: {prev_gold}g -> {gold}g (-{prev_gold - gold}g)",
                details={"from_gold": prev_gold, "to_gold": gold, "spent": prev_gold - gold},
            ))

        prev_gold = gold

    return events


def _detect_level_ups(frames: list[dict]) -> list[GameEvent]:
    """Detect player level increases."""
    events = []
    prev_level = None

    for frame in frames:
        level = frame.get("level")
        if level is None:
            continue
        if prev_level is not None and level > prev_level:
            events.append(GameEvent(
                round=frame.get("round"),
                timestamp_sec=frame["timestamp_sec"],
                event_type="level_up",
                description=f"Leveled up to {level}",
                details={"from_level": prev_level, "to_level": level},
            ))
        prev_level = level

    return events


def assemble_timeline(frames: list[dict]) -> GameTimeline:
    """Assemble analyzed frames into a game timeline with detected events.

    Args:
        frames: List of full analysis results, sorted by timestamp.

    Returns:
        GameTimeline with frames, events, and round transitions.
    """
    # Sort by timestamp
    frames = sorted(frames, key=lambda f: f.get("timestamp_sec", 0))

    # Detect round transitions
    round_transitions = _detect_round_transitions(frames)

    # Detect all event types
    events = []
    events.extend(_detect_pivots(frames))
    events.extend(_detect_power_spikes(frames))
    events.extend(_detect_item_changes(frames))
    events.extend(_detect_economy_events(frames))
    events.extend(_detect_level_ups(frames))

    # Sort events by timestamp
    events.sort(key=lambda e: e.timestamp_sec)

    return GameTimeline(
        frames=frames,
        events=events,
        round_transitions=round_transitions,
    )
