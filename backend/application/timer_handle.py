"""计时任务句柄 - ServiceObject 等通过句柄查询计时状态"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, Optional
from uuid import uuid4

if TYPE_CHECKING:
    from application.time_manager import TimeManager


class TimerType(str, Enum):
    """计时器类型"""
    SERVICE = "SERVICE"              # 服务计时（递增，用于调度）
    WAIT = "WAIT"                    # 等待计时（倒计时，时间片轮转）
    DETAIL = "DETAIL"                # 详单计时（记录空调使用时长）
    ACCOMMODATION = "ACCOMMODATION"  # 入住计时（记录入住时长）


@dataclass
class TimerHandle:
    """
    计时任务句柄
    
    ServiceObject 等持有此句柄，通过它向 TimeManager 查询计时状态。
    timer_id 可持久化到数据库，恢复时通过 TimeManager.get_timer_by_id() 重新获取句柄。
    """
    timer_id: str
    timer_type: TimerType
    room_id: str
    _time_manager: Optional["TimeManager"] = None

    @classmethod
    def create(
        cls, 
        timer_type: TimerType, 
        room_id: str, 
        time_manager: "TimeManager"
    ) -> "TimerHandle":
        """创建新的计时句柄"""
        return cls(
            timer_id=str(uuid4()),
            timer_type=timer_type,
            room_id=room_id,
            _time_manager=time_manager
        )

    @classmethod
    def restore(
        cls,
        timer_id: str,
        timer_type: TimerType,
        room_id: str,
        time_manager: "TimeManager"
    ) -> "TimerHandle":
        """从持久化数据恢复句柄"""
        return cls(
            timer_id=timer_id,
            timer_type=timer_type,
            room_id=room_id,
            _time_manager=time_manager
        )

    def bind_time_manager(self, time_manager: "TimeManager") -> None:
        """绑定 TimeManager（用于恢复后重新绑定）"""
        self._time_manager = time_manager

    @property
    def is_valid(self) -> bool:
        """检查句柄是否仍然有效（计时器是否存在）"""
        if not self._time_manager:
            return False
        return self._time_manager.has_timer(self.timer_id)

    @property
    def elapsed_seconds(self) -> int:
        """查询已服务/已等待的秒数"""
        if not self._time_manager:
            return 0
        return self._time_manager.get_elapsed_seconds(self.timer_id)

    @property
    def remaining_seconds(self) -> int:
        """查询剩余秒数（仅对 WAIT 类型有效）"""
        if not self._time_manager:
            return 0
        return self._time_manager.get_remaining_seconds(self.timer_id)

    @property
    def current_fee(self) -> float:
        """查询当前累计费用"""
        if not self._time_manager:
            return 0.0
        return self._time_manager.get_current_fee(self.timer_id)

    @property
    def speed(self) -> Optional[str]:
        """查询计时器关联的风速"""
        if not self._time_manager:
            return None
        return self._time_manager.get_timer_speed(self.timer_id)

    def cancel(self) -> None:
        """取消计时任务"""
        if self._time_manager:
            self._time_manager.cancel_timer(self.timer_id)

    def __repr__(self) -> str:
        valid = self.is_valid if self._time_manager else "unbound"
        return f"TimerHandle(id={self.timer_id[:8]}..., type={self.timer_type.value}, room={self.room_id}, valid={valid})"

