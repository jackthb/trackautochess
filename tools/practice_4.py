from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

events = [
    {"dasher_id": "D1", "delivery_id": "X1", "timestamp": 0, "event_type": "PICKUP"},
    {"dasher_id": "D1", "delivery_id": "X2", "timestamp": 60, "event_type": "PICKUP"},
    {"dasher_id": "D1", "delivery_id": "X1", "timestamp": 180, "event_type": "DROPOFF"},
    {"dasher_id": "D1", "delivery_id": "X2", "timestamp": 300, "event_type": "DROPOFF"},
]


class EventType(Enum):
    PICKUP = "PICKUP"
    DROPOFF = "DROPOFF"


@dataclass
class DeliveryEvent:
    dasher_id: str
    delivery_id: str
    timestamp: int
    event_type: EventType

    @classmethod
    def from_dict(cls, event):
        return DeliveryEvent(
            dasher_id=event["dasher_id"],
            delivery_id=event["delivery_id"],
            timestamp=event["timestamp"],
            event_type=EventType(event["event_type"]),
        )


class Solution:
    BASE_PAY = 0.3  # per minute
    TIME_IN_MINUTE = 60

    PEAK_HOUR_START = 17
    PEAK_HOUR_END = 19
    PEAK_MULTIPLE = 1.5

    def compute_payout(self) -> dict:
        event_dtos = [DeliveryEvent.from_dict(i) for i in events]
        events_sorted = sorted(event_dtos, key=lambda event: event.timestamp)

        earnings = defaultdict(float)
        active_per_dasher = defaultdict(int)

        prev_time = None

        for e in events_sorted:
            if prev_time is not None:
                gap = (e.timestamp - prev_time) / self.TIME_IN_MINUTE
                for dasher_id, active_count in active_per_dasher.items():
                    base_pay = gap * self.BASE_PAY * active_count
                    peak_pay = self.PEAK_MULTIPLE if self._is_peak(e.timestamp) else 1
                    earnings[dasher_id] += base_pay * peak_pay

            if e.event_type == EventType.PICKUP:
                active_per_dasher[e.dasher_id] += 1
            else:
                active_per_dasher[e.dasher_id] -= 1

            prev_time = e.timestamp

        return earnings

    def _is_peak(self, timestamp: int):
        time = datetime.fromtimestamp(timestamp, tz=timezone.utc).hour

        return self.PEAK_HOUR_START < time < self.PEAK_HOUR_END


def main():
    solution = Solution()
    earnings = solution.compute_payout()
    print(earnings)


if __name__ == "__main__":
    main()
