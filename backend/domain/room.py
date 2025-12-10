"""酒店客房领域模型（含温控规则，来自 PPT）。"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class RoomStatus(str, Enum):
    VACANT = "VACANT"
    OCCUPIED = "OCCUPIED"


@dataclass
class Room:
    room_id: str
    status: RoomStatus = RoomStatus.VACANT
    current_temp: float = 25.0
    target_temp: float = 25.0
    initial_temp: float = 25.0
    mode: str = "cool"
    speed: str = "MID"
    is_serving: bool = False
    ac_enabled: bool = False  # 空调是否被用户开启（用于控制自动重启）
    total_fee: float = 0.0
    rate_per_night: float = 300.0
    active_service_id: Optional[str] = None
    last_temp_change_timestamp: Optional[datetime] = None
    pending_target_temp: Optional[float] = None
    manual_powered_off: bool = False
    metadata: dict = field(default_factory=dict)

    def mark_occupied(self, initial_temp: Optional[float] = None) -> None:
        """标记房间已入住，初始化初始温度。"""
        self.status = RoomStatus.OCCUPIED
        if initial_temp is not None:
            self.initial_temp = initial_temp

    def mark_vacant(self) -> None:
        """标记房间空闲，清理当前服务状态。"""
        self.status = RoomStatus.VACANT
        self.active_service_id = None
        self.is_serving = False

    # 温控规则（来自 PPT）：调温节流（<1s 仅采最后一次）
    def request_target_temp(self, target: float, now: datetime, throttle_ms: int) -> bool:
        """
        请求修改目标温度。

        返回 True 表示本次调温已立即生效；
        返回 False 表示仍在节流窗口内，仅记录为“待应用”的最后一次调温。
        """
        self.pending_target_temp = None
        if self.last_temp_change_timestamp:
            delta_ms = (now - self.last_temp_change_timestamp).total_seconds() * 1000
            if delta_ms < throttle_ms:
                # 仍在节流窗口内：只保留最新一次调温
                self.pending_target_temp = target
                return False
        self.target_temp = target
        self.last_temp_change_timestamp = now
        return True

    # 温控规则（来自 PPT）：节流窗口结束时应用最后一次调温
    def apply_pending_target(self, now: datetime, throttle_ms: int) -> None:
        """在节流时间结束后，将最后一次调温请求真正写入 target_temp。"""
        if self.pending_target_temp is None:
            return
        if not self.last_temp_change_timestamp:
            self.target_temp = self.pending_target_temp
            self.pending_target_temp = None
            self.last_temp_change_timestamp = now
            return
        delta_ms = (now - self.last_temp_change_timestamp).total_seconds() * 1000
        if delta_ms >= throttle_ms:
            self.target_temp = self.pending_target_temp
            self.pending_target_temp = None
            self.last_temp_change_timestamp = now

    # 温控规则（来自 PPT）：按秒推进温度模型
    def tick_temperature(self, temp_config: dict, *, serving: bool) -> bool:
        """
        每秒推进一次温度。

        在送风状态下：
        - 中风：0.5℃/min
        - 高风：中风基础 +20%
        - 低风：中风基础 -20%
        达到目标温度时返回 True，用于触发自动停送风。

        在非送风/等待状态下：
        - 以 idle_drift_per_min 值向 initial_temp 漂移。
        """
        mid_delta = float(temp_config.get("mid_delta_per_min", 0.5))
        high_multiplier = float(temp_config.get("high_multiplier", 1.2))
        low_multiplier = float(temp_config.get("low_multiplier", 0.8))
        idle_drift = float(temp_config.get("idle_drift_per_min", 0.5))

        if serving:
            multiplier = 1.0
            if self.speed == "HIGH":
                multiplier = high_multiplier
            elif self.speed == "LOW":
                multiplier = low_multiplier
            delta_per_sec = (mid_delta * multiplier) / 60.0
            reached = self._move_towards(self.target_temp, delta_per_sec)
            return reached

        # 非送风 / 等待：向初始温度回漂
        delta_per_sec = idle_drift / 60.0
        self._move_towards(self.initial_temp, delta_per_sec)
        return False

    # 温控规则（来自 PPT）：偏离 ≥ 阈值时自动重启
    def needs_auto_restart(self, threshold: float) -> bool:
        """判断当前温度是否相对目标温度偏离超过阈值，用于自动重启送风。"""
        return abs(self.current_temp - self.target_temp) >= threshold

    def _move_towards(self, target: float, delta_per_sec: float) -> bool:
        """按给定步长向目标温度靠近，返回是否恰好到达目标。"""
        if delta_per_sec <= 0:
            return abs(self.current_temp - target) < 1e-3
        difference = target - self.current_temp
        if abs(difference) <= delta_per_sec:
            self.current_temp = target
            return True
        step = delta_per_sec if difference > 0 else -delta_per_sec
        self.current_temp += step
        return False

