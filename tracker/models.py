"""Data models for the DAC tracker."""

from dataclasses import dataclass
from enum import Enum


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
    notes: str           # free-form notes
