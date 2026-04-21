from collections import defaultdict
from dataclasses import dataclass
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

    # Repository layer
    def fetch_events(self) -> list[dict]:
        return events

    # Service Layer
    def get_delivery_events(self) -> list[DeliveryEvent]:
        events = self.fetch_events()
        event_dtos = [DeliveryEvent.from_dict(event) for event in events]

        return sorted(event_dtos, key=lambda event: event.timestamp)

    def process_earnings(self, events: list[DeliveryEvent]) -> dict:
        earnings = defaultdict(float)
        last_time = {}
        for e in events:
            event_hash = f"{e.dasher_id}{e.delivery_id}"
            if e.event_type == EventType.PICKUP:
                last_time[event_hash] = e.timestamp
            else:
                last = last_time[event_hash]
                time_working = e.timestamp - last
                pay = self.BASE_PAY * (time_working / self.TIME_IN_MINUTE)
                earnings[e.dasher_id] += round(pay, 2)

        return earnings

    def compute_payout(self) -> dict:
        events = self.get_delivery_events()
        payout = self.process_earnings(events)
        return payout


def main():
    solution = Solution()
    earnings = solution.compute_payout()
    print(earnings)


if __name__ == "__main__":
    main()
