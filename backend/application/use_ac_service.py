"""Application service for room-side AC operations with温控模型."""
from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional, TYPE_CHECKING

from app.config import AppConfig
from domain.room import Room, RoomStatus
from infrastructure.repository import RoomRepository
from infrastructure.sqlite_repo import SQLiteRoomRepository
from application.billing_service import BillingService

if TYPE_CHECKING:  # pragma: no cover - typing guard
    from application.scheduler import Scheduler


class TemperatureRangeError(Exception):
    """温度超出允许范围的异常。"""
    pass


class UseACService:
    """Implements房间控制流程 + 温控逻辑入口."""

    def __init__(
        self,
        config: AppConfig,
        scheduler: Optional["Scheduler"] = None,
        repository: Optional[RoomRepository] = None,
        billing_service: Optional["BillingService"] = None,
    ):
        self.config = config
        self.repo: RoomRepository = repository or SQLiteRoomRepository()
        self.scheduler: Optional["Scheduler"] = None
        self.billing_service: BillingService = billing_service or BillingService(config, self.repo)
        if scheduler:
            self.attach_scheduler(scheduler)

    def update_config(self, config: AppConfig) -> None:
        """Refresh runtime configuration for defaults and throttling."""
        self.config = config

    # Infrastructure helpers ------------------------------------------------
    def attach_scheduler(self, scheduler: "Scheduler") -> None:
        self.scheduler = scheduler
        scheduler.set_room_repository(self.repo)
        scheduler.set_billing_service(self.billing_service)

    def _ensure_scheduler(self) -> "Scheduler":
        if not self.scheduler:
            raise RuntimeError("Scheduler is required for AC service.")
        return self.scheduler

    def _ensure_room(self, room_id: str) -> Room:
        room = self.repo.get_room(room_id)
        if not room:
            temp_cfg = self.config.temperature or {}
            default_target = float(temp_cfg.get("default_target", 25))
            accommodation_cfg = self.config.accommodation or {}
            default_rate = float(accommodation_cfg.get("rate_per_night", 300.0))
            room = Room(
                room_id=room_id,
                current_temp=default_target,
                target_temp=default_target,
                initial_temp=default_target,
                rate_per_night=default_rate,
            )
            self.repo.save_room(room)
        return room

    # Public API ------------------------------------------------------------
    def _validate_target_temp(self, target_temp: float, mode: str) -> None:
        """验证目标温度是否在合法范围内。"""
        temp_cfg = self.config.temperature or {}
        
        if mode == "cool":
            temp_range = temp_cfg.get("cool_range", [18, 25])
        elif mode == "heat":
            temp_range = temp_cfg.get("heat_range", [25, 30])
        else:
            # 默认使用制冷范围
            temp_range = temp_cfg.get("cool_range", [18, 25])
        
        min_temp, max_temp = float(temp_range[0]), float(temp_range[1])
        
        if target_temp < min_temp or target_temp > max_temp:
            raise TemperatureRangeError(
                f"Target temperature {target_temp}°C is out of range for {mode} mode. "
                f"Valid range: {min_temp}°C - {max_temp}°C"
            )
    
    def power_on(
        self,
        room_id: str,
        mode: Optional[str] = None,
        target_temp: Optional[float] = None,
        speed: Optional[str] = None,
    ) -> None:
        room = self._ensure_room(room_id)
        # 仅标记为已入住，不再重置 initial_temp，保持环境温度稳定用于回温
        room.mark_occupied()

        temp_cfg = self.config.temperature or {}

        # 如果是从“手动关机”状态重新开机，则视为一次全新的开机，
        # 不沿用之前的目标温度达标状态和风速。
        was_manual_off = getattr(room, "manual_powered_off", False)
        if was_manual_off:
            # 清除上一控温周期的“已达标”标记（如果有）
            if isinstance(getattr(room, "metadata", None), dict):
                room.metadata.pop("has_reached_target", None)

        # 确定模式
        room.mode = mode or room.mode or "cool"

        # 目标温度策略：
        # - 如果调用方明确传入 target_temp，则在合法范围内使用该值；
        # - 否则无条件回落到配置的 default_target，而不是沿用旧的目标温度。
        if target_temp is not None:
            self._validate_target_temp(target_temp, room.mode)
            room.target_temp = target_temp
        else:
            room.target_temp = float(temp_cfg.get("default_target", 25.0))

        # 风速策略：
        # - 如果调用方显式给了 speed，则按传入值；
        # - 否则如果是从手动关机恢复，则回落到默认风速 MID；
        # - 其他情况沿用房间当前风速（首次开机时会回落到 MID）。
        if speed is not None:
            room.speed = speed
        else:
            if was_manual_off:
                room.speed = "MID"
            else:
                room.speed = room.speed or "MID"

        room.is_serving = False
        room.manual_powered_off = False

        self.repo.save_room(room)
        self.billing_service.close_current_detail_record(room_id, datetime.utcnow())
        self._ensure_scheduler().on_new_request(room_id, room.speed)

    def change_temp(self, room_id: str, target_temp: float) -> None:
        room = self._ensure_room(room_id)
        
        # 验证温度范围
        self._validate_target_temp(target_temp, room.mode)
        
        throttle_cfg = self.config.throttle or {}
        throttle_ms = int(throttle_cfg.get("change_temp_ms", 1000))
        now = datetime.utcnow()
        room.request_target_temp(target_temp, now, throttle_ms)
        self.repo.save_room(room)

    def change_speed(self, room_id: str, speed: str) -> None:
        room = self._ensure_room(room_id)
        self.billing_service.close_current_detail_record(room_id, datetime.utcnow())
        room.speed = speed
        self.repo.save_room(room)
        self._ensure_scheduler().on_new_request(room_id, speed)

    def power_off(self, room_id: str) -> None:
        room = self._ensure_room(room_id)
        room.is_serving = False
        room.status = RoomStatus.OCCUPIED
        room.manual_powered_off = True  # 标记空调已关闭，阻止自动重启
        scheduler = self._ensure_scheduler()
        self.billing_service.close_current_detail_record(room_id, datetime.utcnow())
        self.repo.save_room(room)
        scheduler.cancel_request(room_id)
