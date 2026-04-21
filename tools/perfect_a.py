"""
Reference Variant A — time × concurrency × rate.

Uses Model A (per-delivery accumulation): each delivery contributes its full
duration to the Dasher's pay. Overlapping deliveries encode concurrency
automatically — two overlapping deliveries each contribute their full duration,
so overlapping minutes are counted as many times as there are concurrent
deliveries. No explicit `active` tracking needed.

Peak hours: pickup-decides-peak. Whichever hour window the delivery is picked
up in applies for the whole delivery. Simple, predictable, defensible.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum


class EventType(Enum):
    PICKUP = "PICKUP"
    DROPOFF = "DROPOFF"


@dataclass(frozen=True)
class DeliveryEvent:
    dasher_id: str
    delivery_id: str
    timestamp: int
    event_type: EventType

    @classmethod
    def from_dict(cls, raw: dict) -> DeliveryEvent:
        return cls(
            dasher_id=raw["dasher_id"],
            delivery_id=raw["delivery_id"],
            timestamp=raw["timestamp"],
            event_type=EventType(raw["event_type"]),
        )


@dataclass(frozen=True)
class Delivery:
    dasher_id: str
    delivery_id: str
    pickup_time: int
    dropoff_time: int

    @property
    def duration_minutes(self) -> float:
        return (self.dropoff_time - self.pickup_time) / 60


class Solution:
    RATE_PER_MINUTE = 0.30
    PEAK_HOUR_START = 17
    PEAK_HOUR_END = 19
    PEAK_MULTIPLIER = 1.5

    def compute_payout(self, raw_events: list[dict]) -> dict[str, float]:
        events = [DeliveryEvent.from_dict(e) for e in raw_events]
        deliveries = self._pair_events(events)

        earnings: dict[str, float] = defaultdict(float)
        for delivery in deliveries:
            earnings[delivery.dasher_id] += self._pay_for_delivery(delivery)

        return {dasher_id: round(pay, 2) for dasher_id, pay in earnings.items()}

    def _pair_events(self, events: list[DeliveryEvent]) -> list[Delivery]:
        pickups: dict[tuple[str, str], int] = {}
        deliveries: list[Delivery] = []

        for e in sorted(events, key=lambda e: e.timestamp):
            key = (e.dasher_id, e.delivery_id)
            if e.event_type == EventType.PICKUP:
                pickups[key] = e.timestamp
            else:
                deliveries.append(Delivery(
                    dasher_id=e.dasher_id,
                    delivery_id=e.delivery_id,
                    pickup_time=pickups.pop(key),
                    dropoff_time=e.timestamp,
                ))

        return deliveries

    def _pay_for_delivery(self, delivery: Delivery) -> float:
        base = self.RATE_PER_MINUTE * delivery.duration_minutes
        if self._is_peak(delivery.pickup_time):
            return base * self.PEAK_MULTIPLIER
        return base

    def _is_peak(self, timestamp: int) -> bool:
        hour = datetime.fromtimestamp(timestamp, tz=timezone.utc).hour
        return self.PEAK_HOUR_START <= hour < self.PEAK_HOUR_END


def main():
    events = [
        {"dasher_id": "D1", "delivery_id": "X1", "timestamp": 0,   "event_type": "PICKUP"},
        {"dasher_id": "D1", "delivery_id": "X2", "timestamp": 60,  "event_type": "PICKUP"},
        {"dasher_id": "D1", "delivery_id": "X1", "timestamp": 180, "event_type": "DROPOFF"},
        {"dasher_id": "D1", "delivery_id": "X2", "timestamp": 300, "event_type": "DROPOFF"},
    ]
    print(Solution().compute_payout(events))
    # Expected: {"D1": 2.10}


if __name__ == "__main__":
    main()
