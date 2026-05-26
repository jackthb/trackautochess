"""Data models for the DAC tracker."""

from dataclasses import dataclass


# DEPRECATED: Used by the retired games table path (push_game / CV import).
# New match data flows through match_players via nettable capture.
@dataclass
class PlayerGameRow:
    """One player's result in a match.

    Accepts strings for placement/level/wl for convenience — push_game()
    converts to the proper DB types (smallint, wins/losses split).
    """
    played_at: str           # ISO datetime — used to create the parent game
    placement: str           # "1" through "8" (stored as smallint in DB)
    rank: str = ""           # e.g. "Bishop-1"
    rank_change: str = ""    # "up", "down", "none"
    lineup: str = ""         # pipe-separated unit names
    synergies: str = ""      # pipe-separated e.g. "Knight:6|Troll:4"
    talents: str = ""        # pipe-separated talent names
    relic: str = ""          # final relic name
    level: str = ""          # player level at game end (stored as smallint)
    wl: str = ""             # win-loss record e.g. "21-17" (split to wins/losses in DB)
    screenshot: str = ""     # public URL
    replay: str = ""         # replay filename
    notes: str = ""
    match_id: str = ""        # groups all players from the same lobby


# Backwards-compatible alias — all existing call sites use `GameRow`
# DEPRECATED: See PlayerGameRow note above.
GameRow = PlayerGameRow
