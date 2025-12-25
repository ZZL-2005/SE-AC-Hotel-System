"""Fine-grained detail record for billing statements."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class ACDetailRecord:
    """A single AC service segment, used for bills and detailed statements."""

    record_id: str
    room_id: str
    speed: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    logic_start_seconds: Optional[int] = None  # seconds since latest check-in (TimeManager)
    logic_end_seconds: Optional[int] = None  # seconds since latest check-in (TimeManager)
    rate_per_min: float = 0.0
    fee_value: float = 0.0
    timer_id: Optional[str] = None  # associated TimeManager detail timer
