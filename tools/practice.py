# === PROBLEM ===

# Given a list of delivery events for one dasher, return the total payout for the day.

# Each event: { id: str, status: "accepted" | "delivered" | "cancelled", timestamp: datetime }

# Lifecycle: each delivery has one `accepted` event, then later one `delivered` or `cancelled`.
# Multiple deliveries can be active concurrently.

# Pay model: each delivery earns $10 × (1 + 0.25 × concurrent_count_at_acceptance).
# Cancelled deliveries are not paid.

# Return: float — total payout, rounded to 2dp.
#
# events_1 = [
#     DeliveryEvent("D1", DeliveryStatus.ACCEPTED,  datetime(2026, 4, 20, 10, 0)),
#     DeliveryEvent("D2", DeliveryStatus.ACCEPTED,  datetime(2026, 4, 20, 10, 10)),
#     DeliveryEvent("D1", DeliveryStatus.DELIVERED, datetime(2026, 4, 20, 10, 30)),
#     DeliveryEvent("D2", DeliveryStatus.DELIVERED, datetime(2026, 4, 20, 10, 40)),
# ]

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class DeliveryStatus(Enum):
    ACCEPTED = "accepted"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class DeliveryEvent:
    id: str
    status: DeliveryStatus
    timestamp: datetime


@dataclass(frozen=True)
class PeakWindow:
    start: datetime
    end: datetime


class Solution:
    DELIVERY_FEE = 10.0
    BASE_MULTIPLIER = 0.25
    PEAK_MULTIPLIER = 2

    def calculate_payout(
        self, events: list[DeliveryEvent], peak_windows: list[PeakWindow] = []
    ) -> float:
        if not events:
            return 0.0

        events_sorted = sorted(events, key=lambda event: event.timestamp)
        active = 0

        multipliers = {}
        statuses = {}

        for event in events_sorted:
            if event.status == DeliveryStatus.ACCEPTED:
                concurrent_mult = 1 + active * self.BASE_MULTIPLIER
                peak_mult = (
                    self.PEAK_MULTIPLIER
                    if self._is_peak(event.timestamp, peak_windows)
                    else 1.0
                )
                multipliers[event.id] = concurrent_mult * peak_mult

                active += 1
            else:
                statuses[event.id] = event.status
                active -= 1

        total = 0.0

        for event_id, mult in multipliers.items():
            if statuses[event_id] == DeliveryStatus.DELIVERED:
                total += mult * self.DELIVERY_FEE
        print(multipliers)
        return round(total, 2)

    def _is_peak(self, time: datetime, windows: list[PeakWindow]):
        return any(w.start <= time <= w.end for w in windows)


if __name__ == "__main__":
    events = [
        DeliveryEvent("D1", DeliveryStatus.ACCEPTED, datetime(2026, 4, 20, 10, 0)),
        DeliveryEvent("D2", DeliveryStatus.ACCEPTED, datetime(2026, 4, 20, 10, 10)),
        DeliveryEvent("D1", DeliveryStatus.DELIVERED, datetime(2026, 4, 20, 10, 30)),
        DeliveryEvent("D2", DeliveryStatus.DELIVERED, datetime(2026, 4, 20, 10, 40)),
    ]

    peak_window = [
        PeakWindow(
            start=datetime(2026, 4, 20, 10, 00), end=datetime(2026, 4, 20, 10, 10)
        )
    ]

    solution = Solution()
    result = solution.calculate_payout(events, peak_window)

    print(f"Payout: ${result}")
    # Expected: Payout: $22.5
