"""Append and read rows from the games CSV file."""

import csv
from dataclasses import dataclass, fields, astuple
from enum import Enum
from pathlib import Path


class RankChange(str, Enum):
    UP = "up"
    DOWN = "down"
    NONE = "none"


@dataclass
class GameRow:
    date: str            # ISO datetime e.g. "2024-01-15 21:34:00"
    placement: str       # "1" through "8"
    rank: str            # e.g. "Bishop-1"
    rank_change: str     # RankChange value: "up", "down", "none"
    lineup: str          # pipe-separated unit names (nullable)
    synergies: str       # pipe-separated e.g. "Knight:6|Troll:4" (nullable)
    talents: str         # pipe-separated talent names (nullable)
    relic: str           # final relic name if visible (nullable)
    level: str           # player level at game end (nullable)
    wl: str              # win-loss record e.g. "21-17" (nullable)
    screenshot: str      # filename of saved screenshot
    notes: str           # free-form notes


FIELDNAMES = [f.name for f in fields(GameRow)]


def append_row(row: GameRow, path: Path) -> None:
    """Append one row to the CSV, creating it with a header if new."""
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not path.exists() or path.stat().st_size == 0
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow(FIELDNAMES)
        writer.writerow(astuple(row))


def read_all(path: Path) -> list[GameRow]:
    """Return all rows from the CSV as GameRow instances."""
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return [
            GameRow(**{k: row.get(k, "") for k in FIELDNAMES})
            for row in reader
        ]
