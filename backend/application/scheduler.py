"""Scheduler - event-driven AC service scheduler."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Dict, Iterable, List, Optional, TYPE_CHECKING

from app.config import AppConfig
from application.events import AsyncEventBus, SchedulerEvent, EventType
from application.time_manager import TimeManager
from domain.room import Room, RoomStatus
from domain.queues import ServiceQueue, WaitingQueue
from domain.service_object import ServiceObject, ServiceStatus, SPEED_PRIORITY
from infrastructure.socketio_manager import push_room_state, push_system_event

if TYPE_CHECKING:  # pragma: no cover - typing only
    from application.billing_service import BillingService
    from infrastructure.repository import RoomRepository


def compare_speed(speed_a: str, speed_b: str) -> int:
    """Compare priority of two speeds."""
    return ServiceObject.compare_speed(speed_a, speed_b)


def select_victim_by_rules(
    services: List[ServiceObject],
    new_speed: str,
) -> Optional[ServiceObject]:
    """
    Select a victim in service queue to be preempted by a new request.

    Rules:
    1. Only consider services with lower speed priority than the new request.
    2. If all such services have the same speed, choose the longest-served.
    3. Otherwise, choose among the lowest-speed group, then longest-served.
    """
    slower_items = [obj for obj in services if compare_speed(obj.speed, new_speed) < 0]
    if not slower_items:
        return None
    if len(slower_items) == 1:
        return slower_items[0]

    distinct_speeds = {obj.speed for obj in slower_items}
    if len(distinct_speeds) == 1:
        return max(slower_items, key=lambda obj: obj.served_seconds)

    min_priority = min(SPEED_PRIORITY.get(obj.speed, 0) for obj in slower_items)
    candidates = [
        obj for obj in slower_items
        if SPEED_PRIORITY.get(obj.speed, 0) == min_priority
    ]
    return max(candidates, key=lambda obj: obj.served_seconds)


@dataclass
class Scheduler:
    """
    Event-driven scheduler responsible for AC service dispatching.

    Responsibilities:
    - Handle AC service requests (power on/off, change speed, etc.)
    - Maintain service and waiting queues
    - React to TimeManager events (time slice, temperature reached, auto-restart)
    """

    config: AppConfig
    time_manager: TimeManager
    event_bus: AsyncEventBus
    service_queue: Optional[ServiceQueue] = None
    waiting_queue: Optional[WaitingQueue] = None

    def __post_init__(self) -> None:
        self._reload_config()
        self._room_lookup: Callable[[str], Optional[Room]] = lambda room_id: None
        self._iter_rooms: Callable[[], Iterable[Room]] = lambda: []
        self._save_room: Callable[[Room], None] = lambda room: None
        self._billing_service: Optional["BillingService"] = None
        # Preserve continuous served seconds for rooms that temporarily reach target
        self._preserved_served_seconds: Dict[str, int] = {}
        self._register_event_handlers()

    # --------------------------------------------------------------------- #
    # Configuration / wiring
    # --------------------------------------------------------------------- #
    def _register_event_handlers(self) -> None:
        self.event_bus.register_handler(
            EventType.TIME_SLICE_EXPIRED,
            self._handle_time_slice_expired,
        )
        self.event_bus.register_handler(
            EventType.TEMPERATURE_REACHED,
            self._handle_temperature_reached,
        )
        self.event_bus.register_handler(
            EventType.AUTO_RESTART_NEEDED,
            self._handle_auto_restart,
        )

    def _reload_config(self) -> None:
        scheduling_cfg = self.config.scheduling or {}
        self.max_concurrent = int(scheduling_cfg.get("max_concurrent", 3))
        self.time_slice_seconds = int(scheduling_cfg.get("time_slice_seconds", 60))

    def update_config(self, config: AppConfig) -> None:
        self.config = config
        self._reload_config()
        self.time_manager.update_config(config)

    # Dependency injection -------------------------------------------------
    def set_queues(self, service_queue: ServiceQueue, waiting_queue: WaitingQueue) -> None:
        self.service_queue = service_queue
        self.waiting_queue = waiting_queue

    def set_room_repository(self, repository: "RoomRepository") -> None:
        self._room_lookup = repository.get_room
        self._iter_rooms = repository.list_rooms
        self._save_room = repository.save_room
        self.time_manager.set_room_repository(repository)

    def set_billing_service(self, billing_service: "BillingService") -> None:
        self._billing_service = billing_service
        self.time_manager.set_fee_callback(billing_service.tick_fee)

    # --------------------------------------------------------------------- #
    # Async event handlers
    # --------------------------------------------------------------------- #
    async def _handle_time_slice_expired(self, event: SchedulerEvent) -> None:
        """
        Handle time-slice expiration by rotating only within the same speed.

        Additional rule:
        - The victim to be rotated out must also have been
          serving for at least one full time slice.
        """
        waiting_room_id = event.room_id
        waiting_service = self._get_wait_entry(waiting_room_id)
        if not waiting_service:
            return

        services = self._list_service_entries()
        same_speed_services = [s for s in services if s.speed == waiting_service.speed]
        if not same_speed_services:
            return

        # Only consider victims that have already been serving for at least
        # one full time slice, to avoid rotating out very new sessions.
        eligible_services = [
            s for s in same_speed_services
            if self._get_served_seconds(s) >= self.time_slice_seconds
        ]
        if not eligible_services:
            return

        victim = self._longest_served(eligible_services)
        if not victim:
            return

        print(f"[Scheduler] Time slice expired: rotating {victim.room_id} -> {waiting_room_id}")

        # Move longest-served (same speed) into waiting queue
        self._move_to_waiting(victim, time_slice_enforced=True)

        # Promote the waiting room into service queue
        if self.waiting_queue:
            self.waiting_queue.remove(waiting_room_id)

        # Cancel its WAIT timer before assigning service
        self._cancel_timer_for_entry(waiting_service)
        self.assign_service(waiting_service)

        await push_room_state(victim.room_id)
        await push_room_state(waiting_room_id)
        await push_system_event(
            "rotation",
            waiting_room_id,
            f"Room {waiting_room_id} enters service, room {victim.room_id} moves to waiting.",
        )

    async def _handle_temperature_reached(self, event: SchedulerEvent) -> None:
        """Stop service when target temperature is reached."""
        print(f"[Scheduler] Temperature reached for room {event.room_id}")
        # Preserve the served seconds so that an immediate auto-restart does not
        # reset its fairness window.
        self.release_service(event.room_id, preserve_elapsed=True)
        await push_room_state(event.room_id)
        await push_system_event(
            "target_reached",
            event.room_id,
            f"Room {event.room_id} reached target temperature.",
        )

    async def _handle_auto_restart(self, event: SchedulerEvent) -> None:
        """Handle auto-restart requests triggered by TimeManager."""
        speed = event.payload.get("speed", "MID") if event.payload else "MID"
        print(f"[Scheduler] Auto restart for room {event.room_id} with speed {speed}")
        self.on_new_request(event.room_id, speed)
        await push_room_state(event.room_id)
        await push_system_event(
            "auto_restart",
            event.room_id,
            f"Room {event.room_id} auto-restarted with speed {speed}.",
        )

    # --------------------------------------------------------------------- #
    # Public API
    # --------------------------------------------------------------------- #
    def on_new_request(self, room_id: str, speed: str) -> None:
        """Handle a new AC service request from a room."""
        self._remove_existing(room_id)
        service = ServiceObject(room_id=room_id, speed=speed)

        # Before handling the new request, make sure any idle capacity is offered
        # to the waiting queue so existing requests are not starved.
        self._fill_capacity_if_possible()

        services = self._list_service_entries()
        print(f"[Scheduler] on_new_request: room={room_id}, speed={speed}")
        print(f"[Scheduler] current services: {len(services)}/{self.max_concurrent}")

        if len(services) < self.max_concurrent:
            print("[Scheduler] Queue not full, assigning directly")
            self.assign_service(service)
            return

        victim = select_victim_by_rules(services, service.speed)
        print(f"[Scheduler] select_victim_by_rules result: {victim.room_id if victim else None}")
        if victim:
            print(f"[Scheduler] Preempting: victim={victim.room_id} (speed={victim.speed})")
            self.preempt(victim, service)
            return

        has_same_speed = any(s.speed == service.speed for s in services)
        print(f"[Scheduler] Has same speed in service queue: {has_same_speed}")
        self._enqueue_waiting(service, time_slice_enforced=has_same_speed)

    def on_request(self, room_id: str, speed: str) -> None:
        """Alias for on_new_request."""
        self.on_new_request(room_id, speed)

    def assign_service(self, service: ServiceObject) -> None:
        """Assign a service object into the service queue."""
        service.status = ServiceStatus.SERVING
        service.started_at = service.started_at or datetime.utcnow()
        service.priority_token = 0
        service.time_slice_enforced = False

        initial_elapsed = int(self._preserved_served_seconds.pop(service.room_id, 0))
        timer_handle = self.time_manager.create_service_timer(
            service.room_id,
            service.speed,
            initial_elapsed=initial_elapsed,
        )
        service.attach_timer(timer_handle)

        if self.service_queue:
            self.service_queue.add(service)

        room = self._room_lookup(service.room_id)
        if room:
            room.is_serving = True
            room.speed = service.speed
            self._save_room(room)

        self._start_detail_segment(service.room_id, service.speed)

    def release_service(self, room_id: str, *, preserve_elapsed: bool = False) -> None:
        """Release a room from the service queue."""
        service = self._get_service_entry(room_id)
        if not service:
            return

        if preserve_elapsed:
            self._preserved_served_seconds[room_id] = self._get_served_seconds(service)
        else:
            self._preserved_served_seconds.pop(room_id, None)

        service.status = ServiceStatus.STOPPED
        self._cancel_timer_for_entry(service)

        if self.service_queue:
            self.service_queue.remove(room_id)

        self._close_detail_segment(room_id)

        room = self._room_lookup(room_id)
        if room:
            room.is_serving = False
            self._save_room(room)

        self._fill_capacity_if_possible()

    def cancel_request(self, room_id: str) -> None:
        """Cancel a pending or active request (service and waiting queues)."""
        self._preserved_served_seconds.pop(room_id, None)
        service = self._get_service_entry(room_id)
        if service:
            self._cancel_timer_for_entry(service)
        if self.service_queue:
            self.service_queue.remove(room_id)

        wait_entry = self._get_wait_entry(room_id)
        if wait_entry:
            self._cancel_timer_for_entry(wait_entry)
        if self.waiting_queue:
            self.waiting_queue.remove(room_id)

        self._close_detail_segment(room_id)

        room = self._room_lookup(room_id)
        if room:
            room.is_serving = False
            self._save_room(room)

    def preempt(self, victim: ServiceObject, new_service: ServiceObject) -> None:
        """Preempt a victim in service queue with a new service request."""
        if self.service_queue:
            self.service_queue.remove(victim.room_id)

        self._cancel_timer_for_entry(victim)
        self._close_detail_segment(victim.room_id)

        self._enqueue_waiting(victim, time_slice_enforced=False)
        self._boost_waiting_priority(new_service.speed)
        self.assign_service(new_service)

    # --------------------------------------------------------------------- #
    # Internal helpers
    # --------------------------------------------------------------------- #
    def _cancel_timer_for_entry(self, service: ServiceObject) -> None:
        """Ensure timers associated with the service are properly cancelled."""
        if not service:
            return

        timer_id = getattr(service, "timer_id", None)

        if getattr(service, "has_timer", False):
            service.cancel_timer()
        else:
            service.timer_id = None

        if timer_id:
            try:
                self.time_manager.cancel_timer(timer_id)
            except Exception:
                # In debugging scenarios we do not want missing timers to crash the scheduler.
                pass

    def _remove_existing(self, room_id: str) -> None:
        """Remove existing entries for a room from service/waiting queues."""
        service = self._get_service_entry(room_id)
        if service:
            self._cancel_timer_for_entry(service)
            self.release_service(room_id)

        wait_entry = self._get_wait_entry(room_id)
        if wait_entry:
            self._cancel_timer_for_entry(wait_entry)

        if self.waiting_queue:
            self.waiting_queue.remove(room_id)

    def _enqueue_waiting(self, service: ServiceObject, *, time_slice_enforced: bool) -> None:
        """Put a service object into the waiting queue."""
        service.time_slice_enforced = time_slice_enforced
        service.status = ServiceStatus.WAITING

        timer_handle = self.time_manager.create_wait_timer(
            room_id=service.room_id,
            speed=service.speed,
            wait_seconds=self.time_slice_seconds,
            time_slice_enforced=time_slice_enforced,
        )
        service.attach_timer(timer_handle)

        if self.waiting_queue:
            self.waiting_queue.add(service)

        room = self._room_lookup(service.room_id)
        if room:
            room.is_serving = False
            self._save_room(room)

    def _move_to_waiting(self, service: ServiceObject, *, time_slice_enforced: bool) -> None:
        """Move a service object from service queue to waiting queue."""
        if self.service_queue:
            self.service_queue.remove(service.room_id)

        self._cancel_timer_for_entry(service)
        self._close_detail_segment(service.room_id)

        service.time_slice_enforced = time_slice_enforced
        service.status = ServiceStatus.WAITING

        timer_handle = self.time_manager.create_wait_timer(
            room_id=service.room_id,
            speed=service.speed,
            wait_seconds=self.time_slice_seconds,
            time_slice_enforced=time_slice_enforced,
        )
        service.attach_timer(timer_handle)

        if self.waiting_queue:
            self.waiting_queue.add(service)

        room = self._room_lookup(service.room_id)
        if room:
            room.is_serving = False
            self._save_room(room)

        print(
            f"[Scheduler] Moved to waiting: room={service.room_id}, "
            f"time_slice_enforced={time_slice_enforced}"
        )

    def _fill_capacity_if_possible(self) -> None:
        """Promote waiting rooms into service queue when capacity allows."""
        while True:
            services = self._list_service_entries()
            if len(services) >= self.max_concurrent:
                break
            if not self.waiting_queue or self.waiting_queue.size() == 0:
                break

            next_service = self._select_highest_priority_waiting()
            if not next_service:
                break

            self.waiting_queue.remove(next_service.room_id)
            self._cancel_timer_for_entry(next_service)
            self.assign_service(next_service)

    def _boost_waiting_priority(self, new_speed: str) -> None:
        """Increase priority tokens for waiting entries with the same speed."""
        wait_entries = self._list_wait_entries()
        for service in wait_entries:
            if service.speed == new_speed:
                service.priority_token += 1
                if self.waiting_queue:
                    self.waiting_queue.update(service)

    # Billing helpers ------------------------------------------------------
    def _start_detail_segment(self, room_id: str, speed: str) -> None:
        if not self._billing_service:
            return
        self._billing_service.start_new_detail_record(room_id, speed, datetime.utcnow())

    def _close_detail_segment(self, room_id: str) -> None:
        if not self._billing_service:
            return
        self._billing_service.close_current_detail_record(room_id, datetime.utcnow())

    # Queue helpers --------------------------------------------------------
    def _list_service_entries(self) -> List[ServiceObject]:
        if not self.service_queue:
            return []
        return self.service_queue.list_all()

    def _list_wait_entries(self) -> List[ServiceObject]:
        if not self.waiting_queue:
            return []
        return self.waiting_queue.list_all()

    def _get_service_entry(self, room_id: str) -> Optional[ServiceObject]:
        if not self.service_queue:
            return None
        return self.service_queue.get(room_id)

    def _get_wait_entry(self, room_id: str) -> Optional[ServiceObject]:
        if not self.waiting_queue:
            return None
        return self.waiting_queue.get(room_id)

    def _get_served_seconds(self, service: ServiceObject) -> int:
        """
        Best-effort lookup of a service entry's served seconds.

        For SQLite-backed queues, ServiceObject instances reconstructed from
        the database do not carry a live TimerHandle, so service.served_seconds
        would always be 0. To enforce the "victim must have served at least one
        full time slice" rule, we resolve the timer via TimeManager when needed.
        """
        if not service:
            return 0

        # Prefer an attached TimerHandle if present
        handle = getattr(service, "_timer_handle", None)
        if handle is not None and getattr(handle, "is_valid", False):
            return int(getattr(handle, "elapsed_seconds", 0) or 0)

        # Fall back to resolving by timer_id via TimeManager
        timer_id = getattr(service, "timer_id", None)
        if timer_id:
            try:
                timer_handle = self.time_manager.get_timer_by_id(timer_id)
            except Exception:
                timer_handle = None
            if timer_handle and getattr(timer_handle, "is_valid", False):
                return int(getattr(timer_handle, "elapsed_seconds", 0) or 0)

        return 0

    def _longest_served(self, services: List[ServiceObject]) -> Optional[ServiceObject]:
        if not services:
            return None
        return max(services, key=self._get_served_seconds)

    def _select_highest_priority_waiting(self) -> Optional[ServiceObject]:
        """
        Select the highest-priority waiting service.

        Rules:
        1. Highest speed priority: HIGH > MID > LOW.
        2. Within same speed, higher `priority_token` first.
        3. Within same speed and token, longer waited is better, but any
           difference less than 2 seconds is treated as equal.
        4. If still tied, smaller room_id (numeric) wins.
        """
        wait_entries = self._list_wait_entries()
        if not wait_entries:
            return None

        # 1) filter by highest speed priority
        max_speed_priority = max(SPEED_PRIORITY.get(s.speed, 0) for s in wait_entries)
        speed_candidates = [
            s for s in wait_entries
            if SPEED_PRIORITY.get(s.speed, 0) == max_speed_priority
        ]

        # 2) within same speed, pick highest priority_token
        max_token = max(s.priority_token for s in speed_candidates)
        token_candidates = [s for s in speed_candidates if s.priority_token == max_token]

        # 3) within same speed and token, pick those whose waited time
        #    is within 10 seconds of the maximum
        max_waited = max(s.total_waited_seconds for s in token_candidates)
        tolerance = 10  # seconds
        tolerant_candidates = [
            s for s in token_candidates
            if (max_waited - s.total_waited_seconds) < tolerance
        ]

        # 4) tie-breaker: smaller numeric room_id wins
        def _room_sort_key(s: ServiceObject) -> int:
            try:
                return int(s.room_id)
            except (TypeError, ValueError):
                return 0

        return min(tolerant_candidates, key=_room_sort_key)
