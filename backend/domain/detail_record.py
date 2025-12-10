"""Fine-grained detail record for billing statements."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class ACDetailRecord:
    """# PPT 计费规则: 详单需要记录每一段风速/时间/费用."""

    record_id: str
    room_id: str
    speed: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    rate_per_min: float = 0.0
    fee_value: float = 0.0
    timer_id: Optional[str] = None  # 关联 TimeManager 计时器
