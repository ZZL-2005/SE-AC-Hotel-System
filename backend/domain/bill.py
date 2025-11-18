"""Billing aggregates for air conditioning usage."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import List

from .detail_record import ACDetailRecord


@dataclass
class ACBill:
    """# PPT 计费规则: 汇总空调详单为账单."""

    bill_id: str
    room_id: str
    period_start: datetime
    period_end: datetime
    total_fee: float = 0.0
    details: List[ACDetailRecord] = field(default_factory=list)

    def add_record(self, record: ACDetailRecord) -> None:
        self.details.append(record)
        self.total_fee += record.fee_value
