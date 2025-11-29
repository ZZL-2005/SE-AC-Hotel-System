"""Service session model representing an AC request lifecycle."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, Tuple


class ServiceStatus(str, Enum):
    SERVING = "SERVING"
    WAITING = "WAITING"
    STOPPED = "STOPPED"


# 风速优先级映射（业务规则）
SPEED_PRIORITY = {"HIGH": 3, "MID": 2, "LOW": 1}


@dataclass
class ServiceObject:
    """服务会话对象，表示一个空调服务请求的生命周期"""
    room_id: str
    speed: str
    started_at: Optional[datetime] = None
    served_seconds: int = 0
    wait_seconds: int = 0
    total_waited_seconds: int = 0
    priority_token: int = 0
    time_slice_enforced: bool = False
    status: ServiceStatus = ServiceStatus.WAITING
    current_fee: float = 0.0

    def priority_key(self) -> Tuple[int, int, int]:
        """
        返回优先级排序键，用于队列排序。
        优先级规则：风速优先级 > 优先级令牌 > 等待时长
        """
        return (
            SPEED_PRIORITY.get(self.speed, 0),
            self.priority_token,
            self.total_waited_seconds,
        )

    @staticmethod
    def compare_speed(speed_a: str, speed_b: str) -> int:
        """比较两个风速的优先级，返回 1/-1/0"""
        priority_a = SPEED_PRIORITY.get(speed_a, 0)
        priority_b = SPEED_PRIORITY.get(speed_b, 0)
        if priority_a > priority_b:
            return 1
        if priority_a < priority_b:
            return -1
        return 0
