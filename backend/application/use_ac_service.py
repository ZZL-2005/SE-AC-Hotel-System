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
            room = Room(
                room_id=room_id,
                current_temp=default_target,
                target_temp=default_target,
                initial_temp=default_target,
            )
            self.repo.save_room(room)
        return room

    # Public API ------------------------------------------------------------
    def power_on(self, room_id: str, mode: str, target_temp: float, speed: str) -> None:
        room = self._ensure_room(room_id)
        room.mark_occupied(initial_temp=room.current_temp)
        room.mode = mode
        room.speed = speed
        room.target_temp = target_temp
        room.is_serving = False
        self.repo.save_room(room)
        self.billing_service.close_current_detail_record(room_id, datetime.utcnow())
        self._ensure_scheduler().on_new_request(room_id, speed)

    def change_temp(self, room_id: str, target_temp: float) -> None:
        room = self._ensure_room(room_id)
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
        scheduler = self._ensure_scheduler()
        self.billing_service.close_current_detail_record(room_id, datetime.utcnow())
        self.repo.save_room(room)
        scheduler.cancel_request(room_id)
