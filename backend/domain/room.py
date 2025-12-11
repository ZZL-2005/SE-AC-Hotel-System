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
    total_fee: float = 0.0
    rate_per_night: float = 300.0
    active_service_id: Optional[str] = None
    last_temp_change_timestamp: Optional[datetime] = None
    pending_target_temp: Optional[float] = None
    # 空调是否被用户手动关闭（用于控制自动重启）
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

    # 温控规则：调温节流（1s 内仅采最后一次）
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
        # 生效的新目标温度视为开启新的控温周期，清除“已达标”标记
        self.metadata.pop("has_reached_target", None)
        self.target_temp = target
        self.last_temp_change_timestamp = now
        return True

    # 温控规则：节流窗口结束时应用最后一次调温
    def apply_pending_target(self, now: datetime, throttle_ms: int) -> None:
        """在节流时间结束后，将最后一次调温请求真正写入 target_temp。"""
        if self.pending_target_temp is None:
            return
        if not self.last_temp_change_timestamp:
            # 应用挂起的目标温度前，清除已达标标记
            self.metadata.pop("has_reached_target", None)
            self.target_temp = self.pending_target_temp
            self.pending_target_temp = None
            self.last_temp_change_timestamp = now
            return
        delta_ms = (now - self.last_temp_change_timestamp).total_seconds() * 1000
        if delta_ms >= throttle_ms:
            # 节流窗口结束，正式切换目标温度，清除已达标标记
            self.metadata.pop("has_reached_target", None)
            self.target_temp = self.pending_target_temp
            self.pending_target_temp = None
            self.last_temp_change_timestamp = now

    # 温控规则：按秒推进温度模型
    def tick_temperature(self, temp_config: dict, *, serving: bool) -> bool:
        """
        每秒推进一次温度。

        在送风状态下：
        - 中风：mid_delta_per_min ℃/min
        - 高风：中风基础 * high_multiplier
        - 低风：中风基础 * low_multiplier
        达到目标温度时返回 True，用于触发自动停送风。

        在非送风 / 等待状态下：
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

        # 非送风 / 等待 / 关机：始终向初始温度回漂
        delta_per_sec = idle_drift / 60.0
        self._move_towards(self.initial_temp, delta_per_sec)
        return False

    # 温控规则：偏离阈值时自动重启
    def needs_auto_restart(self, threshold: float) -> bool:
        """判断当前温度是否相对目标温度偏离超过阈值，用于自动重启送风。"""
        return abs(self.current_temp - self.target_temp) >= threshold

    def _move_towards(self, target: float, delta_per_sec: float) -> bool:
        """按给定步长向目标温度靠近，返回是否“刚刚”到达目标（不是已经在目标）。

        为了兼容浮点精度误差，避免出现“温度几乎等于目标但永远不触发达标事件”的情况，
        对接近目标的情形做了容差处理：
        - 如果已经精确等于目标：视为保持在目标，不再触发事件；
        - 如果在一个很小的误差范围内：直接对齐到目标并视为“刚到达”；
        - 如果差值在单步步长之内（含少量误差）：也视为“刚到达”。
        """
        if delta_per_sec <= 0:
            return False  # 无变化，不算“到达”

        difference = target - self.current_temp
        eps = 1e-6

        # 已经在目标温度（完全相等）：不触发事件
        if abs(difference) == 0.0:
            return False

        # 差值极小（浮点误差范围内）：拉齐到目标，视为刚刚到达
        if abs(difference) < eps:
            self.current_temp = target
            return True

        # 如果差距在一步之内（允许少量浮点误差），则直接对齐目标温度并视为“刚到达”
        if abs(difference) <= delta_per_sec + eps:
            self.current_temp = target
            return True

        # 否则按步长推进一小步
        step = delta_per_sec if difference > 0 else -delta_per_sec
        self.current_temp += step
        return False

