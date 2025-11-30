"""Scheduler implementing 调度+温控+计费，使用队列接口实现解耦。"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Iterable, List, Optional

from app.config import AppConfig
from application.billing_service import BillingService
from domain.room import Room, RoomStatus
from domain.queues import ServiceQueue, WaitingQueue
from domain.service_object import ServiceObject, ServiceStatus, SPEED_PRIORITY
from infrastructure.repository import RoomRepository


def compare_speed(speed_a: str, speed_b: str) -> int:
    """比较两个风速的优先级"""
    return ServiceObject.compare_speed(speed_a, speed_b)


def select_victim_by_rules(services: List[ServiceObject], new_speed: str) -> Optional[ServiceObject]:
    """根据调度规则选择被抢占的服务对象"""
    print(f"[select_victim] new_speed={new_speed}, services speeds={[s.speed for s in services]}")
    slower_items = [obj for obj in services if compare_speed(obj.speed, new_speed) < 0]
    print(f"[select_victim] slower_items={[s.room_id for s in slower_items]}")
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
    """调度器，负责管理空调服务的调度、温控和计费"""
    config: AppConfig
    service_queue: Optional[ServiceQueue] = None
    waiting_queue: Optional[WaitingQueue] = None

    def __post_init__(self) -> None:
        scheduling_cfg = self.config.scheduling or {}
        self.max_concurrent = int(scheduling_cfg.get("max_concurrent", 3))
        self.time_slice_seconds = int(scheduling_cfg.get("time_slice_seconds", 60))
        throttle_cfg = self.config.throttle or {}
        self.throttle_ms = int(throttle_cfg.get("change_temp_ms", 1000))
        temperature_cfg = self.config.temperature or {}
        self.auto_restart_threshold = float(temperature_cfg.get("auto_restart_threshold", 1.0))
        self._room_lookup: Callable[[str], Optional[Room]] = lambda room_id: None
        self._iter_rooms: Callable[[], Iterable[Room]] = lambda: []
        self._save_room: Callable[[Room], None] = lambda room: None
        self._billing_service: Optional[BillingService] = None

    # ================== 依赖注入 ==================
    def set_queues(self, service_queue: ServiceQueue, waiting_queue: WaitingQueue) -> None:
        """设置队列实现"""
        self.service_queue = service_queue
        self.waiting_queue = waiting_queue

    def set_room_repository(self, repository: RoomRepository) -> None:
        """设置房间仓储"""
        self._room_lookup = repository.get_room
        self._iter_rooms = repository.list_rooms
        self._save_room = repository.save_room

    def set_billing_service(self, billing_service: BillingService) -> None:
        """设置计费服务"""
        self._billing_service = billing_service

    # ================== Public API ==================
    def on_new_request(self, room_id: str, speed: str) -> None:
        """处理新的空调服务请求"""
        self._remove_existing(room_id)
        service = ServiceObject(room_id=room_id, speed=speed)

        services = self._list_service_entries()
        print(f"[Scheduler] on_new_request: room={room_id}, speed={speed}")
        print(f"[Scheduler] current services: {len(services)}/{self.max_concurrent}")
        for s in services:
            print(f"  - room={s.room_id}, speed={s.speed}, served={s.served_seconds}s")

        if len(services) < self.max_concurrent:
            print(f"[Scheduler] Queue not full, assigning directly")
            self.assign_service(service)
            return

        victim = select_victim_by_rules(services, service.speed)
        print(f"[Scheduler] select_victim_by_rules result: {victim.room_id if victim else None}")
        if victim:
            print(f"[Scheduler] Preempting: victim={victim.room_id} (speed={victim.speed})")
            self.preempt(victim, service)
            return

        # 比较新请求与服务队列中每个对象的风速
        cmp_results = [compare_speed(service.speed, item.speed) for item in services]
        highest_cmp = max(cmp_results) if cmp_results else -1
        print(f"[Scheduler] No victim found")
        print(f"[Scheduler] New request speed: {service.speed}")
        print(f"[Scheduler] Service queue speeds: {[s.speed for s in services]}")
        print(f"[Scheduler] Compare results: {cmp_results}, highest_cmp={highest_cmp}")
        
        # 只有当新请求风速与服务队列中最高风速相同时，才启用时间片轮转
        # 但这个逻辑有问题：应该是只要有相同风速就启用轮转
        # 修正：检查是否存在相同风速
        has_same_speed = any(s.speed == service.speed for s in services)
        print(f"[Scheduler] Has same speed in service queue: {has_same_speed}")
        
        if has_same_speed:
            self._enqueue_waiting(service, time_slice_enforced=True)
        else:
            self._enqueue_waiting(service, time_slice_enforced=False)

    def on_request(self, room_id: str, speed: str) -> None:
        """处理请求（on_new_request 的别名）"""
        self.on_new_request(room_id, speed)

    def tick_1s(self) -> None:
        """每秒执行一次的调度循环"""
        self._apply_pending_targets()
        self._advance_serving()
        self._advance_waiting()
        self._update_room_temperatures()
        self._handle_auto_restart()
        self._fill_capacity_if_possible()

    def tick(self, timestamp: datetime) -> None:  # pragma: no cover
        """执行一次调度（timestamp 参数保留兼容性）"""
        self.tick_1s()

    def assign_service(self, service: ServiceObject) -> None:
        """将服务对象分配到服务队列"""
        service.status = ServiceStatus.SERVING
        service.started_at = service.started_at or datetime.utcnow()
        service.wait_seconds = 0
        service.priority_token = 0
        service.time_slice_enforced = False
        
        if self.service_queue:
            self.service_queue.add(service)
        
        room = self._room_lookup(service.room_id)
        if room:
            room.is_serving = True
            room.speed = service.speed
            self._save_room(room)
        self._start_detail_segment(service.room_id, service.speed)

    def release_service(self, room_id: str) -> None:
        """释放服务（从服务队列移除）"""
        service = self._get_service_entry(room_id)
        if not service:
            return
        service.status = ServiceStatus.STOPPED
        
        if self.service_queue:
            self.service_queue.remove(room_id)
        
        self._close_detail_segment(room_id)
        room = self._room_lookup(room_id)
        if room:
            room.is_serving = False
            self._save_room(room)
        self._fill_capacity_if_possible()

    def cancel_request(self, room_id: str) -> None:
        """取消请求（从服务队列和等待队列中移除）"""
        if self.service_queue:
            self.service_queue.remove(room_id)
        if self.waiting_queue:
            self.waiting_queue.remove(room_id)
        
        self._close_detail_segment(room_id)
        room = self._room_lookup(room_id)
        if room:
            room.is_serving = False
            self._save_room(room)

    def preempt(self, victim: ServiceObject, new_service: ServiceObject) -> None:
        """抢占：将 victim 移到等待队列，将 new_service 分配到服务队列"""
        if self.service_queue:
            self.service_queue.remove(victim.room_id)
        self._close_detail_segment(victim.room_id)
        self._enqueue_waiting(victim, time_slice_enforced=False)
        self._boost_waiting_priority(new_service.speed)
        self.assign_service(new_service)

    # ================== 内部辅助方法 ==================
    def _remove_existing(self, room_id: str) -> None:
        """移除指定房间的现有服务/等待记录"""
        if self._get_service_entry(room_id):
            self.release_service(room_id)
        if self.waiting_queue:
            self.waiting_queue.remove(room_id)

    def _enqueue_waiting(self, service: ServiceObject, *, time_slice_enforced: bool) -> None:
        """将服务对象加入等待队列"""
        service.time_slice_enforced = time_slice_enforced
        service.wait_seconds = self.time_slice_seconds
        service.total_waited_seconds = 0
        service.status = ServiceStatus.WAITING
        
        if self.waiting_queue:
            self.waiting_queue.add(service)
        
        room = self._room_lookup(service.room_id)
        if room:
            room.is_serving = False
            self._save_room(room)

    def _fill_capacity_if_possible(self) -> None:
        """当服务队列有空位时，从等待队列提升服务"""
        while True:
            services = self._list_service_entries()
            if len(services) >= self.max_concurrent:
                break
            if not self.waiting_queue or self.waiting_queue.size() == 0:
                break
            # 使用 Scheduler 的优先级选择逻辑
            next_service = self._select_highest_priority_waiting()
            if not next_service:
                break
            self.waiting_queue.remove(next_service.room_id)
            self.assign_service(next_service)

    def _advance_serving(self) -> None:
        """推进服务队列中所有对象的状态"""
        services = self._list_service_entries()
        for service in services:
            service.served_seconds += 1
            if self._billing_service:
                increment = self._billing_service.tick_fee(service.room_id, service.speed)
                service.current_fee += increment
            if self.service_queue:
                self.service_queue.update(service)

    def _advance_waiting(self) -> None:
        """推进等待队列中所有对象的状态"""
        wait_entries = self._list_wait_entries()
        services = self._list_service_entries()
        service_speeds = {s.speed for s in services}
        
        for service in wait_entries:
            service.total_waited_seconds += 1
            
            # 动态修正：如果等待对象风速与服务队列中存在相同，启用时间片轮转
            if not service.time_slice_enforced and service.speed in service_speeds:
                service.time_slice_enforced = True
                service.wait_seconds = self.time_slice_seconds  # 重置等待时间
                print(f"[Scheduler] Fixed time_slice_enforced for room={service.room_id}")
            elif service.wait_seconds > 0:
                service.wait_seconds -= 1
            
            if self.waiting_queue:
                self.waiting_queue.update(service)
            
            if service.wait_seconds == 0 and service.time_slice_enforced:
                print(f"[Scheduler] Time slice expired for room={service.room_id}, triggering rotation")
                self._handle_time_slice_expiry(service)

    def _handle_time_slice_expiry(self, waiting_service: ServiceObject) -> None:
        """处理时间片到期：轮转服务"""
        services = self._list_service_entries()
        victim = self._longest_served(services)
        if not victim:
            return
        
        # 将服务最长的移到等待队列
        if self.service_queue:
            self.service_queue.remove(victim.room_id)
        self._close_detail_segment(victim.room_id)
        victim.time_slice_enforced = True
        victim.wait_seconds = self.time_slice_seconds  # 重置等待时间！
        victim.served_seconds = 0  # 重置服务时间
        victim.status = ServiceStatus.WAITING
        if self.waiting_queue:
            self.waiting_queue.add(victim)
        
        room = self._room_lookup(victim.room_id)
        if room:
            room.is_serving = False
            self._save_room(room)
        
        print(f"[Scheduler] Rotated out: room={victim.room_id}, wait_seconds={victim.wait_seconds}")
        
        # 将等待的服务提升到服务队列
        if self.waiting_queue:
            self.waiting_queue.remove(waiting_service.room_id)
        waiting_service.time_slice_enforced = False
        self.assign_service(waiting_service)

    def _boost_waiting_priority(self, new_speed: str) -> None:
        """提升等待队列中相同风速的优先级令牌"""
        wait_entries = self._list_wait_entries()
        for service in wait_entries:
            if service.speed == new_speed:
                service.priority_token += 1
                if self.waiting_queue:
                    self.waiting_queue.update(service)

    def _apply_pending_targets(self) -> None:
        """应用待处理的目标温度"""
        now = datetime.utcnow()
        for room in self._iter_rooms():
            room.apply_pending_target(now, self.throttle_ms)
            self._save_room(room)

    def _update_room_temperatures(self) -> None:
        """更新所有房间的温度"""
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
        """处理自动重启（当温度偏离目标时）"""
        active_rooms = {service.room_id for service in self._list_service_entries()}
        waiting_rooms = {entry.room_id for entry in self._list_wait_entries()}
        for room in self._iter_rooms():
            if room.status == RoomStatus.VACANT:
                continue
            if not room.ac_enabled:  # 用户已关闭空调，不自动重启
                continue
            if room.room_id in active_rooms or room.room_id in waiting_rooms:
                continue
            if room.needs_auto_restart(self.auto_restart_threshold):
                self.on_new_request(room.room_id, room.speed or "MID")

    # ================== 计费相关 ==================
    def _start_detail_segment(self, room_id: str, speed: str) -> None:
        """开始新的计费详单段"""
        if not self._billing_service:
            return
        self._billing_service.start_new_detail_record(room_id, speed, datetime.utcnow())

    def _close_detail_segment(self, room_id: str) -> None:
        """关闭当前计费详单段"""
        if not self._billing_service:
            return
        self._billing_service.close_current_detail_record(room_id, datetime.utcnow())

    # ================== 队列访问方法 ==================
    def _list_service_entries(self) -> List[ServiceObject]:
        """获取服务队列中的所有条目"""
        if not self.service_queue:
            return []
        return self.service_queue.list_all()

    def _list_wait_entries(self) -> List[ServiceObject]:
        """获取等待队列中的所有条目"""
        if not self.waiting_queue:
            return []
        return self.waiting_queue.list_all()

    def _get_service_entry(self, room_id: str) -> Optional[ServiceObject]:
        """根据房间 ID 获取服务队列中的条目"""
        if not self.service_queue:
            return None
        return self.service_queue.get(room_id)

    def _longest_served(self, services: List[ServiceObject]) -> Optional[ServiceObject]:
        """获取服务时间最长的服务对象"""
        if not services:
            return None
        return max(services, key=lambda obj: obj.served_seconds)

    def _select_highest_priority_waiting(self) -> Optional[ServiceObject]:
        """
        从等待队列中选择优先级最高的服务对象。
        
        优先级规则（业务逻辑在 Scheduler 中实现）：
        1. 风速优先级：HIGH > MID > LOW
        2. 同风速时，优先级令牌高的优先
        3. 同令牌时，等待时间长的优先
        """
        wait_entries = self._list_wait_entries()
        if not wait_entries:
            return None
        return max(wait_entries, key=lambda s: s.priority_key())
