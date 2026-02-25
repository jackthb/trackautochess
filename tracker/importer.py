"""Import old match CSV data into games.csv."""

import csv
import sys
from pathlib import Path

from csv_writer import GameRow, append_row, FIELDNAMES


def import_csv(src_path: Path, dest_path: Path, dry_run: bool = False) -> int:
    """
    Import rows from src_path into dest_path.

    The source CSV must have at minimum a 'date' column.
    Columns are mapped by name where they match GameRow fields.
    Unknown source columns are ignored; missing fields default to "".

    Returns the number of rows imported (or previewed).
    """
    if not src_path.exists():
        print(f"[importer] ERROR: Source file not found: {src_path}")
        sys.exit(1)

    rows: list[GameRow] = []
    with src_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for src_row in reader:
            row = GameRow(**{field: src_row.get(field, "") for field in FIELDNAMES})
            rows.append(row)

    if not rows:
        print("[importer] No rows found in source file.")
        return 0

    if dry_run:
        print(f"[importer] DRY RUN — would import {len(rows)} row(s):")
        header = ", ".join(FIELDNAMES)
        print(f"  {header}")
        for row in rows:
            values = ", ".join([
                row.date, row.placement, row.comp, row.synergies,
                row.relic, row.level, row.wl, row.screenshot, row.notes,
            ])
            print(f"  {values}")
    else:
        for row in rows:
            append_row(row, dest_path)
        print(f"[importer] Imported {len(rows)} row(s) into {dest_path}")

    return len(rows)
