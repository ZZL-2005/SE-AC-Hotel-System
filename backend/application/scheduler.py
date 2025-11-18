"""Scheduler implementing调度+温控+计费 with DB-backed queues."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Iterable, List, Optional

from sqlmodel import select

from app.config import AppConfig
from application.billing_service import BillingService
from domain.room import Room, RoomStatus
from infrastructure.repository import RoomRepository

SPEED_PRIORITY = {"HIGH": 3, "MID": 2, "LOW": 1}


class ServiceStatus:
    SERVING = "SERVING"
    WAITING = "WAITING"
    STOPPED = "STOPPED"


@dataclass
class ServiceObject:
    room_id: str
    speed: str
    started_at: Optional[datetime] = None
    served_seconds: int = 0
    wait_seconds: int = 0
    total_waited_seconds: int = 0
    priority_token: int = 0
    time_slice_enforced: bool = False
    status: str = ServiceStatus.WAITING
    current_fee: float = 0.0


def compare_speed(speed_a: str, speed_b: str) -> int:
    priority_a = SPEED_PRIORITY.get(speed_a, 0)
    priority_b = SPEED_PRIORITY.get(speed_b, 0)
    if priority_a > priority_b:
        return 1
    if priority_a < priority_b:
        return -1
    return 0


def select_victim_by_rules(services: List[ServiceObject], new_speed: str) -> Optional[ServiceObject]:
    slower_items = [obj for obj in services if compare_speed(obj.speed, new_speed) < 0]
    if not slower_items:
        return None
    if len(slower_items) == 1:
        return slower_items[0]

    distinct_speeds = {obj.speed for obj in slower_items}
    if len(distinct_speeds) == 1:
        return max(slower_items, key=lambda obj: obj.served_seconds)

    min_priority = min(SPEED_PRIORITY.get(obj.speed, 0) for obj in slower_items)
    candidates = [obj for obj in slower_items if SPEED_PRIORITY.get(obj.speed, 0) == min_priority]
    return max(candidates, key=lambda obj: obj.served_seconds)


@dataclass
class Scheduler:
    config: AppConfig

    def __post_init__(self) -> None:
        scheduling_cfg = self.config.scheduling or {}
        self.max_concurrent = int(scheduling_cfg.get("max_concurrent", 3))
        self.time_slice_seconds = int(scheduling_cfg.get("time_slice_seconds", 60))
        throttle_cfg = self.config.throttle or {}
        self.throttle_ms = int(throttle_cfg.get("change_temp_ms", 1000))
        temperature_cfg = self.config.temperature or {}
        self.auto_restart_threshold = float(temperature_cfg.get("auto_restart_threshold", 1.0))
        self._room_lookup: Callable[[str], Optional["Room"]] = lambda room_id: None
        self._iter_rooms: Callable[[], Iterable["Room"]] = lambda: []
        self._save_room: Callable[[Room], None] = lambda room: None
        self._billing_service: Optional[BillingService] = None
        self._repository: Optional[RoomRepository] = None

    # Public API -----------------------------------------------------------
    def on_new_request(self, room_id: str, speed: str) -> None:
        self._remove_existing(room_id)
        service = ServiceObject(room_id=room_id, speed=speed)

        services = self._list_service_entries()
        if len(services) < self.max_concurrent:
            self.assign_service(service)
            return

        victim = select_victim_by_rules(services, service.speed)
        if victim:
            self.preempt(victim, service)
            return

        cmp_results = [compare_speed(service.speed, item.speed) for item in services]
        highest_cmp = max(cmp_results) if cmp_results else -1
        if highest_cmp == 0:
            self._enqueue_waiting(service, time_slice_enforced=True)
        else:
            self._enqueue_waiting(service, time_slice_enforced=False)

    def on_request(self, room_id: str, speed: str) -> None:
        self.on_new_request(room_id, speed)

    def tick_1s(self) -> None:
        self._apply_pending_targets()
        self._advance_serving()
        self._advance_waiting()
        self._update_room_temperatures()
        self._handle_auto_restart()
        self._fill_capacity_if_possible()

    def tick(self, timestamp: datetime) -> None:  # pragma: no cover
        self.tick_1s()

    def assign_service(self, service: ServiceObject) -> None:
        service.status = ServiceStatus.SERVING
        service.started_at = service.started_at or datetime.utcnow()
        service.wait_seconds = 0
        service.priority_token = 0
        service.time_slice_enforced = False
        self._persist_service_object(service, is_new=True)
        room = self._room_lookup(service.room_id)
        if room:
            room.is_serving = True
            room.speed = service.speed
            self._save_room(room)
        self._start_detail_segment(service.room_id, service.speed)

    def release_service(self, room_id: str) -> None:
        service = self._get_service_entry(room_id)
        if not service:
            return
        service.status = ServiceStatus.STOPPED
        self._remove_service_persistence(room_id)
        self._close_detail_segment(room_id)
        room = self._room_lookup(room_id)
        if room:
            room.is_serving = False
            self._save_room(room)
        self._fill_capacity_if_possible()

    def cancel_request(self, room_id: str) -> None:
        service = self._get_service_entry(room_id)
        if service:
            self._remove_service_persistence(room_id)
        self._remove_wait_entry(room_id)
        self._close_detail_segment(room_id)
        room = self._room_lookup(room_id)
        if room:
            room.is_serving = False
            self._save_room(room)

    def preempt(self, victim: ServiceObject, new_service: ServiceObject) -> None:
        self._remove_service_persistence(victim.room_id)
        self._close_detail_segment(victim.room_id)
        self._enqueue_waiting(victim, time_slice_enforced=False)
        self._boost_waiting_priority(new_service.speed)
        self.assign_service(new_service)

    # Internal helpers -----------------------------------------------------
    def _remove_existing(self, room_id: str) -> None:
        if self._get_service_entry(room_id):
            self.release_service(room_id)
        self._remove_wait_entry(room_id)

    def _enqueue_waiting(self, service: ServiceObject, *, time_slice_enforced: bool) -> None:
        service.time_slice_enforced = time_slice_enforced
        service.wait_seconds = self.time_slice_seconds
        service.total_waited_seconds = 0
        service.status = ServiceStatus.WAITING
        self._save_wait_entry(service)
        room = self._room_lookup(service.room_id)
        if room:
            room.is_serving = False
            self._save_room(room)

    def _fill_capacity_if_possible(self) -> None:
        while True:
            services = self._list_service_entries()
            if len(services) >= self.max_concurrent:
                break
            wait_entries = self._list_wait_entries()
            if not wait_entries:
                break
            next_service = self._pop_highest_priority(wait_entries)
            if not next_service:
                break
            self._remove_wait_entry(next_service.room_id)
            self.assign_service(next_service)

    def _advance_serving(self) -> None:
        services = self._list_service_entries()
        for service in services:
            service.served_seconds += 1
            if self._billing_service:
                increment = self._billing_service.tick_fee(service.room_id, service.speed)
                service.current_fee += increment
            self._persist_service_object(service, is_new=False)

    def _advance_waiting(self) -> None:
        wait_entries = self._list_wait_entries()
        for service in wait_entries:
            service.total_waited_seconds += 1
            if service.wait_seconds > 0:
                service.wait_seconds = max(0, service.wait_seconds - 1)
            self._save_wait_entry(service)
            if service.wait_seconds == 0 and service.time_slice_enforced:
                self._handle_time_slice_expiry(service)

    def _handle_time_slice_expiry(self, waiting_service: ServiceObject) -> None:
        services = self._list_service_entries()
        victim = self._longest_served(services)
        if not victim:
            return
        self._remove_service_persistence(victim.room_id)
        self._close_detail_segment(victim.room_id)
        victim.time_slice_enforced = True
        victim.status = ServiceStatus.WAITING
        self._save_wait_entry(victim)
        self._remove_wait_entry(waiting_service.room_id)
        waiting_service.time_slice_enforced = False
        self.assign_service(waiting_service)

    def _boost_waiting_priority(self, new_speed: str) -> None:
        wait_entries = self._list_wait_entries()
        for service in wait_entries:
            if service.speed == new_speed:
                service.priority_token += 1
                self._save_wait_entry(service)

    def set_room_repository(self, repository: RoomRepository) -> None:
        self._repository = repository
        self._room_lookup = repository.get_room
        self._iter_rooms = repository.list_rooms
        self._save_room = repository.save_room

    def set_billing_service(self, billing_service: BillingService) -> None:
        self._billing_service = billing_service

    def _apply_pending_targets(self) -> None:
        now = datetime.utcnow()
        for room in self._iter_rooms():
            room.apply_pending_target(now, self.throttle_ms)
            self._save_room(room)

    def _update_room_temperatures(self) -> None:
        temp_cfg = self.config.temperature or {}
        active_rooms = {service.room_id for service in self._list_service_entries()}
        for room in self._iter_rooms():
            if room.room_id in active_rooms:
                reached = room.tick_temperature(temp_cfg, serving=True)
                self._save_room(room)
                if reached:
                    self.release_service(room.room_id)
            else:
                room.tick_temperature(temp_cfg, serving=False)
                self._save_room(room)

    def _handle_auto_restart(self) -> None:
        active_rooms = {service.room_id for service in self._list_service_entries()}
        waiting_rooms = {entry.room_id for entry in self._list_wait_entries()}
        for room in self._iter_rooms():
            if room.status == RoomStatus.VACANT:
                continue
            if room.room_id in active_rooms or room.room_id in waiting_rooms:
                continue
            if room.needs_auto_restart(self.auto_restart_threshold):
                self.on_new_request(room.room_id, room.speed or "MID")

    # PPT 计费规则 ---------------------------------------------------------
    def _start_detail_segment(self, room_id: str, speed: str) -> None:
        if not self._billing_service:
            return
        self._billing_service.start_new_detail_record(room_id, speed, datetime.utcnow())

    def _close_detail_segment(self, room_id: str) -> None:
        if not self._billing_service:
            return
        self._billing_service.close_current_detail_record(room_id, datetime.utcnow())

    # Persistence helpers --------------------------------------------------
    def _persist_service_object(self, service: ServiceObject, *, is_new: bool) -> None:
        if not self._repository:
            return
        if is_new:
            self._repository.add_service_object(service)
        else:
            self._repository.update_service_object(service)

    def _remove_service_persistence(self, room_id: str) -> None:
        if self._repository:
            self._repository.remove_service_object(room_id)

    def _list_service_entries(self) -> List[ServiceObject]:
        repo = self._repository
        if not repo:
            return []
        if hasattr(repo, "list_service_objects"):
            return list(repo.list_service_objects())  # type: ignore[attr-defined]
        services_attr = getattr(repo, "_services", None)
        if services_attr is not None:
            return [self._clone_service(obj) for obj in services_attr.values()]
        return self._list_service_entries_sqlite(repo)

    def _list_service_entries_sqlite(self, repo: RoomRepository) -> List[ServiceObject]:
        try:
            from infrastructure.sqlite_repo import SQLiteRoomRepository
            from infrastructure.database import SessionLocal
            from infrastructure.models import ServiceObjectModel
        except ImportError:  # pragma: no cover - fallback
            return []

        if not isinstance(repo, SQLiteRoomRepository):
            return []

        with SessionLocal() as session:
            models = session.exec(select(ServiceObjectModel)).all()
        return [self._service_from_model(model) for model in models]

    def _list_wait_entries(self) -> List[ServiceObject]:
        repo = self._repository
        if not repo:
            return []
        if hasattr(repo, "list_wait_entries"):
            return list(repo.list_wait_entries())
        return self._list_wait_entries_sqlite(repo)

    def _list_wait_entries_sqlite(self, repo: RoomRepository) -> List[ServiceObject]:
        try:
            from infrastructure.sqlite_repo import SQLiteRoomRepository
            from infrastructure.database import SessionLocal
            from infrastructure.models import WaitEntryModel
        except ImportError:  # pragma: no cover
            return []

        if not isinstance(repo, SQLiteRoomRepository):
            services_attr = getattr(repo, "_wait_entries", None)
            if services_attr is not None:
                return [self._clone_service(obj) for obj in services_attr.values()]
            return []

        with SessionLocal() as session:
            models = session.exec(select(WaitEntryModel)).all()
        return [self._wait_from_model(model) for model in models]

    def _get_service_entry(self, room_id: str) -> Optional[ServiceObject]:
        for service in self._list_service_entries():
            if service.room_id == room_id:
                return service
        return None

    def _save_wait_entry(self, service: ServiceObject) -> None:
        if self._repository:
            self._repository.add_wait_entry(service)

    def _remove_wait_entry(self, room_id: str) -> None:
        if self._repository:
            self._repository.remove_wait_entry(room_id)

    def _service_from_model(self, model) -> ServiceObject:
        return ServiceObject(
            room_id=model.room_id,
            speed=model.speed,
            started_at=model.started_at,
            served_seconds=model.served_seconds,
            wait_seconds=model.wait_seconds,
            total_waited_seconds=model.total_waited_seconds,
            priority_token=model.priority_token,
            time_slice_enforced=model.time_slice_enforced,
            status=model.status,
            current_fee=model.current_fee,
        )

    def _wait_from_model(self, model) -> ServiceObject:
        return ServiceObject(
            room_id=model.room_id,
            speed=model.speed,
            wait_seconds=model.wait_seconds,
            total_waited_seconds=model.total_waited_seconds,
            priority_token=model.priority_token,
            status=ServiceStatus.WAITING,
        )

    def _clone_service(self, service: ServiceObject) -> ServiceObject:
        return ServiceObject(**service.__dict__)

    def _pop_highest_priority(self, entries: List[ServiceObject]) -> Optional[ServiceObject]:
        if not entries:
            return None

        def priority_key(obj: ServiceObject) -> tuple[int, int, int]:
            return (
                SPEED_PRIORITY.get(obj.speed, 0),
                obj.priority_token,
                obj.total_waited_seconds,
            )

        best = max(entries, key=priority_key)
        return best

    def _longest_served(self, services: List[ServiceObject]) -> Optional[ServiceObject]:
        if not services:
            return None
        return max(services, key=lambda obj: obj.served_seconds)
