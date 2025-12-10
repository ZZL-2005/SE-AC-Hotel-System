"""Service session model representing an AC request lifecycle."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from application.timer_handle import TimerHandle


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
    priority_token: int = 0
    time_slice_enforced: bool = False
    status: ServiceStatus = ServiceStatus.WAITING
    
    # timer_id 用于持久化，恢复后通过 TimeManager 重新绑定 Handle
    timer_id: Optional[str] = None
    
    # TimerHandle 实例（不持久化，运行时绑定）
    _timer_handle: Optional["TimerHandle"] = field(default=None, repr=False)

    # ================== 计时相关属性（通过 TimerHandle 查询）==================
    @property
    def served_seconds(self) -> int:
        """服务时长（从 TimeManager 查询）"""
        if self._timer_handle and self._timer_handle.is_valid:
            return self._timer_handle.elapsed_seconds
        return 0

    @property
    def wait_seconds(self) -> int:
        """剩余等待时间（从 TimeManager 查询）"""
        if self._timer_handle and self._timer_handle.is_valid:
            return self._timer_handle.remaining_seconds
        return 0

    @property
    def total_waited_seconds(self) -> int:
        """累计等待时长（从 TimeManager 查询）"""
        if self._timer_handle and self._timer_handle.is_valid:
            return self._timer_handle.elapsed_seconds
        return 0

    @property
    def current_fee(self) -> float:
        """当前累计费用（从 TimeManager 查询）"""
        if self._timer_handle and self._timer_handle.is_valid:
            return self._timer_handle.current_fee
        return 0.0

    # ================== 计时任务管理 ==================
    def attach_timer(self, handle: "TimerHandle") -> None:
        """绑定计时任务句柄"""
        self._timer_handle = handle
        self.timer_id = handle.timer_id

    def detach_timer(self) -> Optional["TimerHandle"]:
        """解绑计时任务句柄"""
        handle = self._timer_handle
        self._timer_handle = None
        # 保留 timer_id 用于持久化恢复
        return handle

    def cancel_timer(self) -> None:
        """取消当前计时任务"""
        if self._timer_handle:
            self._timer_handle.cancel()
            self._timer_handle = None
        self.timer_id = None

    @property
    def has_timer(self) -> bool:
        """是否有绑定的计时任务"""
        return self._timer_handle is not None and self._timer_handle.is_valid

    # ================== 优先级计算 ==================
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
