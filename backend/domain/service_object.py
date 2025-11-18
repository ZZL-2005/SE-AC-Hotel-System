"""Service session model representing an AC request lifecycle."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class ServiceStatus(str, Enum):
    SERVING = "SERVING"
    WAITING = "WAITING"
    STOPPED = "STOPPED"


@dataclass
class ServiceObject:
    service_id: str
    room_id: str
    speed: str
    mode: str
    requested_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    served_seconds: int = 0
    waited_seconds: int = 0
    status: ServiceStatus = ServiceStatus.WAITING
