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
        # 保留入住时的初始温度，开机只更新占用状态
        room.mark_occupied()

        # 开机后清除自动重启标记
        if self.scheduler:
            self.scheduler.time_manager.clear_auto_restart_flag(room_id)

        temp_cfg = self.config.temperature or {}
        
        room.powered_on = True
        
        # 确定模式
        room.mode = mode or room.mode or "cool"
        
        # 优先使用传入的 target_temp，其次保留已设置的温度，最后使用配置默认值
        if target_temp is not None:
            self._validate_target_temp(target_temp, room.mode)
            room.target_temp = target_temp
            print(f"[Room {room_id}]Setting target temperature: {room.target_temp}")
        elif room.target_temp is None:
            room.target_temp = float(temp_cfg.get("default_target", 25.0))
            print(f"[Room {room_id}]Using default target temperature: {room.target_temp}")
        # 否则保留 room.target_temp 不变
        print(f"[Room {room_id}]Using previous target temperature: {room.target_temp}")
        room.speed = speed or room.speed or "MID"
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
        room.powered_on = False  # 停止标记已开启
        scheduler = self._ensure_scheduler()
        self.billing_service.close_current_detail_record(room_id, datetime.utcnow())
        self.repo.save_room(room)
        # 关机后清除自动重启标记
        scheduler.time_manager.clear_auto_restart_flag(room_id)
        scheduler.cancel_request(room_id)
