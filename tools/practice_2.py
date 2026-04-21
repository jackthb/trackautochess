from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class DeliveryStatus(Enum):
    ACCEPTED = "ACCEPTED"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


@dataclass(frozen=True)
class DeliveryEvent:
    id: str
    timestamp: datetime
    status: DeliveryStatus


@dataclass(frozen=True)
class PeakHours:
    start_time: datetime
    end_time: datetime


def get_deliveries(dasher_id: str) -> list[dict]:
    return [
        {
            "delivery_id": "d1",
            "status": "ACCEPTED",
            "timestamp": "2026-04-20T12:00:00",
        },
        {
            "delivery_id": "d2",
            "status": "ACCEPTED",
            "timestamp": "2026-04-20T12:15:00",
        },
        {
            "delivery_id": "d1",
            "status": "DELIVERED",
            "timestamp": "2026-04-20T12:30:00",
        },
        {
            "delivery_id": "d2",
            "status": "DELIVERED",
            "timestamp": "2026-04-20T12:45:00",
        },
        {
            "delivery_id": "d3",
            "status": "ACCEPTED",
            "timestamp": "2026-04-20T15:00:00",
        },
        {
            "delivery_id": "d3",
            "status": "DELIVERED",
            "timestamp": "2026-04-20T15:20:00",
        },
        {
            "delivery_id": "d4",
            "status": "ACCEPTED",
            "timestamp": "2026-04-20T18:30:00",
        },
        {
            "delivery_id": "d4",
            "status": "CANCELLED",
            "timestamp": "2026-04-20T18:40:00",
        },
        {
            "delivery_id": "d5",
            "status": "ACCEPTED",
            "timestamp": "2026-04-20T18:45:00",
        },
        {
            "delivery_id": "d5",
            "status": "DELIVERED",
            "timestamp": "2026-04-20T19:15:00",
        },
        {
            "delivery_id": "d6",
            "status": "ACCEPTED",
            "timestamp": "2026-04-20T21:30:00",
        },
    ]


class Solution:
    BASE_PAY = 10.0
    CONCURRENT_MULT = 0.25
    PEAK_MULT = 1.5

    def calculate_payout(
        self, events: list[DeliveryEvent], peak_hours: list[PeakHours]
    ):
        events_sorted = sorted(events, key=lambda e: e.timestamp)
        total, active = 0.0, 0
        mults, statuses = {}, {}

        for event in events_sorted:
            if event.status == DeliveryStatus.ACCEPTED:
                concurrent_mult = 1 + self.CONCURRENT_MULT * active
                peak_mult = (
                    self.PEAK_MULT
                    if self._is_peak(peak_hours=peak_hours, curr_time=event.timestamp)
                    else 1.0
                )
                mults[event.id] = concurrent_mult * peak_mult
                active += 1
            else:  # DELIVERED / CANCELLED
                statuses[event.id] = event.status
                active -= 1

        for id, mult in mults.items():
            if statuses.get(id) == DeliveryStatus.DELIVERED:
                total += mult * self.BASE_PAY
        return round(total, 2)

    def _is_peak(self, peak_hours: list[PeakHours], curr_time: datetime):
        return any(time.start_time <= curr_time <= time.end_time for time in peak_hours)


def main():
    # lets just preprocess and sort out later
    # data/repository layer would be responsible for returning properly shaped dtos
    deliveries = [
        DeliveryEvent(
            id=d["delivery_id"],
            timestamp=datetime.fromisoformat(d["timestamp"]),
            status=DeliveryStatus(d["status"]),
        )
        for d in get_deliveries("test")
    ]
    sol = Solution()
    pay = sol.calculate_payout(
        events=deliveries,
        peak_hours=[
            PeakHours(
                start_time=datetime(2026, 4, 20, 15, 00, 00),
                end_time=datetime(2026, 4, 20, 17, 00, 00),
            )
        ],
    )
    print(pay)


if __name__ == "__main__":
    main()
