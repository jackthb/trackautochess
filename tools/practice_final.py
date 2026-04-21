# from dataclasses import dataclass
# from datetime import datetime
# from enum import Enum


# class EventType(Enum):
#     ACCEPTED = "accepted"
#     DELIVERED = "delivered"
#     CANCELLED = "cancelled"


# @dataclass(frozen=True)
# class DeliveryEvent:
#     id: "str"
#     status: EventType
#     timestamp: datetime


# class Solution:
#     BASE_PAY = 0.3
#     SECONDS_IN_MINUTE = 60

#     PEAK_START = "9:30"
#     PEAK_END = "10:00"
#     PEAK_MULTIPLIER = 2

#     def fetch_and_process_events(self):
#         raw_events = [
#             {"id": "D1", "status": "accepted", "timestamp": "09:00"},
#             {"id": "D2", "status": "accepted", "timestamp": "09:15"},
#             {"id": "D3", "status": "accepted", "timestamp": "09:30"},
#             {"id": "D1", "status": "delivered", "timestamp": "09:40"},
#             {"id": "D2", "status": "cancelled", "timestamp": "09:50"},
#             {"id": "D4", "status": "accepted", "timestamp": "10:00"},
#             {"id": "D3", "status": "delivered", "timestamp": "10:10"},
#             {"id": "D4", "status": "delivered", "timestamp": "10:30"},
#         ]

#         return sorted(
#             [
#                 DeliveryEvent(
#                     id=e["id"],
#                     status=EventType(e["status"]),
#                     timestamp=self.datetime_from_time(e["timestamp"]),
#                 )
#                 for e in raw_events
#             ],
#             key=lambda e: e.timestamp,
#         )

#     def compute_pay(self, events: list[DeliveryEvent]):
#         total: float = 0.0
#         start_times: dict[str, datetime] = {}

#         for e in events:
#             if e.status == EventType.ACCEPTED:
#                 start_times[e.id] = e.timestamp
#             else:
#                 time_worked = e.timestamp - start_times[e.id]
#                 accumulated_pay = (
#                     time_worked.seconds / self.SECONDS_IN_MINUTE * self.BASE_PAY
#                 )
#                 peak_multiplier = (
#                     self.PEAK_MULTIPLIER if self._is_peak(start_times[e.id]) else 1
#                 )
#                 total += accumulated_pay * peak_multiplier
#         return total

#     def _is_peak(self, ts: datetime):
#         return (
#             self.datetime_from_time(self.PEAK_START)
#             <= ts
#             < self.datetime_from_time(self.PEAK_END)
#         )

#     def datetime_from_time(self, ts: str):
#         return datetime.strptime(ts, "%H:%M")


# def main():
#     s = Solution()
#     events = s.fetch_and_process_events()
#     pay = s.compute_pay(events)

#     print(pay)


# if __name__ == "__main__":
#     main()

# If bonus is applied by time

from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum


class EventType(Enum):
    ACCEPTED = "accepted"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class DeliveryEvent:
    id: "str"
    status: EventType
    timestamp: datetime


class Solution:
    BASE_PAY = 0.3
    SECONDS_IN_MINUTE = 60

    PEAK_START = "9:30"
    PEAK_END = "10:00"
    PEAK_MULTIPLIER = 2

    def fetch_and_process_events(self):
        raw_events = [
            {"id": "D1", "status": "accepted", "timestamp": "09:00"},
            {"id": "D2", "status": "accepted", "timestamp": "09:15"},
            {"id": "D3", "status": "accepted", "timestamp": "09:30"},
            {"id": "D1", "status": "delivered", "timestamp": "09:40"},
            {"id": "D2", "status": "cancelled", "timestamp": "09:50"},
            {"id": "D4", "status": "accepted", "timestamp": "10:00"},
            {"id": "D3", "status": "delivered", "timestamp": "10:10"},
            {"id": "D4", "status": "delivered", "timestamp": "10:30"},
        ]

        return sorted(
            [
                DeliveryEvent(
                    id=e["id"],
                    status=EventType(e["status"]),
                    timestamp=self.datetime_from_time(e["timestamp"]),
                )
                for e in raw_events
            ],
            key=lambda e: e.timestamp,
        )

    def compute_pay(self, events: list[DeliveryEvent]):
        total: float = 0.0
        start_times: dict[str, datetime] = {}

        for e in events:
            if e.status == EventType.ACCEPTED:
                start_times[e.id] = e.timestamp
            else:
                total_in_min = (
                    e.timestamp - start_times[e.id]
                ).total_seconds() / self.SECONDS_IN_MINUTE
                minutes_in_peak = self._peak_overlap_in_minutes(
                    start_times[e.id], e.timestamp
                )
                minutes_in_base = total_in_min - minutes_in_peak

                total += (minutes_in_base * self.BASE_PAY) + (
                    minutes_in_peak * self.BASE_PAY * self.PEAK_MULTIPLIER
                )
        return total

    def _is_peak(self, ts: datetime):
        return (
            self.datetime_from_time(self.PEAK_START)
            <= ts
            < self.datetime_from_time(self.PEAK_END)
        )

    def _peak_overlap_in_minutes(self, start: datetime, end: datetime) -> float:
        peak_start = self.datetime_from_time(self.PEAK_START)
        peak_end = self.datetime_from_time(self.PEAK_END)

        overlap_start = max(start, peak_start)
        overlap_end = min(end, peak_end)

        return max(
            0, (overlap_end - overlap_start).total_seconds() / self.SECONDS_IN_MINUTE
        )

    def datetime_from_time(self, ts: str):
        return datetime.strptime(ts, "%H:%M")


def main():
    s = Solution()
    events = s.fetch_and_process_events()
    pay = s.compute_pay(events)

    print(pay)


if __name__ == "__main__":
    main()
