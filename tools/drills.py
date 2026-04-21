"""
Quick fluency drills — datetime, classes, Protocol.

Do these in order. ~15 min total. Answers at the bottom (don't peek until you
attempt each one).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

# ============================================================
# DRILL 1 — Datetime fluency
# ============================================================
#
# Goal: fluent with `datetime.fromtimestamp(ts, tz=timezone.utc).hour`.
#
# TODO: write a function that returns True if a unix timestamp falls between
# 17:00 (inclusive) and 19:00 (exclusive) UTC.


def is_peak(ts: int) -> bool:
    # your code here
    return 17 <= datetime.fromtimestamp(ts, tz=timezone.utc).hour < 19


# Test:
peak_5pm = int(datetime(2026, 4, 20, 17, 30, tzinfo=timezone.utc).timestamp())
not_peak = int(datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc).timestamp())
assert is_peak(peak_5pm) is True
assert is_peak(not_peak) is False
print("DRILL 1 passed")


# ============================================================
# DRILL 2 — Frozen dataclass + classmethod + validation
# ============================================================
#
# Goal: fluent with @dataclass(frozen=True), @classmethod, class constants,
# __post_init__ validation.
#
# TODO: define a `Money` dataclass that:
#   - is frozen (immutable)
#   - has fields: amount (float), currency (str)
#   - has a classmethod `from_cents(cls, cents: int, currency: str) -> Money`
#     that converts integer cents to dollars and returns a Money instance
#   - has a class-level constant CURRENCIES = ("USD", "GBP", "EUR")
#   - has a __post_init__ that raises ValueError if currency not in CURRENCIES


@dataclass(frozen=True)
class Money:
    amount: float
    currency: str

    CURRENCIES = ("USD", "GBP", "EUR")

    @classmethod
    def from_cents(cls, cents: int, currency: str) -> Money:
        return Money(amount=cents / 100, currency=currency)

    def __post_init__(self):
        if self.currency not in self.CURRENCIES:
            raise ValueError("Invalid currency")


# Test:
m = Money.from_cents(250, "USD")
assert m.amount == 2.50
assert m.currency == "USD"
try:
    Money.from_cents(100, "XYZ")
    assert False, "should have raised ValueError"
except ValueError:
    pass
print("DRILL 2 passed")


# ============================================================
# DRILL 3 — Protocol (the one you don't get)
# ============================================================
#
# WHAT IT IS:
#   A way to declare a "shape" (methods/attributes) that any class can satisfy
#   WITHOUT inheriting from the Protocol. Like TypeScript interfaces, Go
#   interfaces, Rust traits with structural typing.
#
#   "If it walks like a duck and quacks like a duck, it's a duck."
#
# WHY USE IT:
#   You want a function to accept ANY class with certain methods, without forcing
#   every implementer to inherit from a base class. Decouples interface from
#   implementation hierarchy. Good for dependency injection and testability.
#
# EXAMPLE (working code below — study it):


class Greeter(Protocol):
    """Anything with a .greet() that returns str satisfies this."""

    def greet(self) -> str: ...


class English:  # no inheritance — satisfies Greeter via shape
    def greet(self) -> str:
        return "Hello"


class French:  # also satisfies Greeter, no inheritance
    def greet(self) -> str:
        return "Bonjour"


def say_hi(g: Greeter) -> None:
    print(g.greet())


# Both work — type checker accepts because they match the Protocol shape:
say_hi(English())  # prints "Hello"
say_hi(French())  # prints "Bonjour"


# TODO: your turn.
# Define a Protocol `PricingRule` with one method:
#   def apply(self, base_pay: float, duration_minutes: float) -> float
#
# Then define two classes (no inheritance!) that satisfy it:
#   1. `FlatRate` — ignores duration, returns base_pay as-is
#   2. `TimeMultiplier` — returns base_pay * duration_minutes
#
# Then write a function that applies a list of PricingRule sequentially.


class PricingRule(Protocol):
    def apply(self, base_pay: float, duration_minutes: float) -> float: ...


class FlatRate:
    def apply(self, base_pay: float, _duration_minutes: float):
        return base_pay


class TimeMultiplier:
    def apply(self, base_pay: float, duration_minutes: float) -> float:
        return base_pay * duration_minutes


# your PricingRule Protocol here
# your FlatRate class here
# your TimeMultiplier class here
def apply_all(rules, base, duration):
    result = base
    for r in rules:
        result = r.apply(result, duration)
    return result


# Test:
rules = [FlatRate(), TimeMultiplier()]
result = apply_all(rules, base=10.0, duration=2.0)
assert result == 20.0  # FlatRate: 10 → 10, then TimeMultiplier: 10 * 2 = 20
print("DRILL 3 passed")

# def apply_all(rules: list[PricingRule], base: float, duration: float) -> float:
#     result = base
#     for rule in rules:
#         result = rule.apply(result, duration)
#     return result
