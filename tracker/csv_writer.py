"""Append and read rows from the games CSV file."""

import csv
from dataclasses import dataclass, fields, astuple
from pathlib import Path


@dataclass
class GameRow:
    date: str        # ISO datetime e.g. "2024-01-15 21:34:00"
    placement: str   # "1" through "8"
    comp: str        # LLM-inferred name e.g. "6 Knights, 4 Trolls"
    synergies: str   # pipe-separated e.g. "Knight:6|Troll:4|Demon:2"
    talents: str     # pipe-separated talent names e.g. "Extra Gold|Knight Bonus"
    relic: str       # final relic name if visible, else ""
    level: str       # player level at game end e.g. "9"
    wl: str          # win-loss record e.g. "21-17"
    screenshot: str  # relative path to saved screenshot
    notes: str       # empty by default, user fills in manually


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
