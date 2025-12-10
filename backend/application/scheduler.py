"""Scheduler - 事件驱动的调度器，负责空调服务的调度业务逻辑。"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Iterable, List, Optional, TYPE_CHECKING

from app.config import AppConfig
from application.events import AsyncEventBus, SchedulerEvent, EventType
from application.time_manager import TimeManager
from domain.room import Room, RoomStatus
from domain.queues import ServiceQueue, WaitingQueue
from domain.service_object import ServiceObject, ServiceStatus, SPEED_PRIORITY
from infrastructure.socketio_manager import push_room_state, push_system_event

if TYPE_CHECKING:
    from application.billing_service import BillingService
    from infrastructure.repository import RoomRepository


def compare_speed(speed_a: str, speed_b: str) -> int:
    """比较两个风速的优先级"""
    return ServiceObject.compare_speed(speed_a, speed_b)


def select_victim_by_rules(services: List[ServiceObject], new_speed: str) -> Optional[ServiceObject]:
    """根据调度规则选择被抢占的服务对象"""
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
    """
    事件驱动的调度器
    
    职责：
    - 处理空调服务请求（开机、关机、调速等）
    - 管理服务队列和等待队列
    - 响应 TimeManager 发送的超时事件
    
    不再包含：
    - tick_1s() 时钟推进（已移至 TimeManager）
    - 计时逻辑（已移至 TimeManager）
    - 温度模拟（已移至 TimeManager）
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
        
        # 注册异步事件处理器
        self._register_event_handlers()

    def _register_event_handlers(self) -> None:
        """注册事件处理器"""
        self.event_bus.register_handler(
            EventType.TIME_SLICE_EXPIRED, 
            self._handle_time_slice_expired
        )
        self.event_bus.register_handler(
            EventType.TEMPERATURE_REACHED, 
            self._handle_temperature_reached
        )
        self.event_bus.register_handler(
            EventType.AUTO_RESTART_NEEDED, 
            self._handle_auto_restart
        )

    def _reload_config(self) -> None:
        """从配置加载参数"""
        scheduling_cfg = self.config.scheduling or {}
        self.max_concurrent = int(scheduling_cfg.get("max_concurrent", 3))
        self.time_slice_seconds = int(scheduling_cfg.get("time_slice_seconds", 60))

    def update_config(self, config: AppConfig) -> None:
        """更新配置"""
        self.config = config
        self._reload_config()
        self.time_manager.update_config(config)

    # ================== 依赖注入 ==================
    def set_queues(self, service_queue: ServiceQueue, waiting_queue: WaitingQueue) -> None:
        """设置队列实现"""
        self.service_queue = service_queue
        self.waiting_queue = waiting_queue

    def set_room_repository(self, repository: "RoomRepository") -> None:
        """设置房间仓储"""
        self._room_lookup = repository.get_room
        self._iter_rooms = repository.list_rooms
        self._save_room = repository.save_room
        self.time_manager.set_room_repository(repository)

    def set_billing_service(self, billing_service: "BillingService") -> None:
        """设置计费服务"""
        self._billing_service = billing_service
        # 设置计费回调给 TimeManager
        self.time_manager.set_fee_callback(billing_service.tick_fee)

    # ================== 异步事件处理器 ==================
    async def _handle_time_slice_expired(self, event: SchedulerEvent) -> None:
        """处理时间片到期事件"""
        waiting_room_id = event.room_id
        waiting_service = self._get_wait_entry(waiting_room_id)
        if not waiting_service:
            return
        
        services = self._list_service_entries()
        victim = self._longest_served(services)
        if not victim:
            return
        
        print(f"[Scheduler] Time slice expired: rotating {victim.room_id} -> {waiting_room_id}")
        
        # 将服务最长的移到等待队列
        self._move_to_waiting(victim, time_slice_enforced=True)
        
        # 将等待的服务提升到服务队列
        if self.waiting_queue:
            self.waiting_queue.remove(waiting_room_id)
        waiting_service.cancel_timer()
        self.assign_service(waiting_service)
        
        # 推送状态更新给前端
        await push_room_state(victim.room_id)
        await push_room_state(waiting_room_id)
        await push_system_event("rotation", waiting_room_id, f"房间 {waiting_room_id} 开始服务，房间 {victim.room_id} 进入等待")

    async def _handle_temperature_reached(self, event: SchedulerEvent) -> None:
        """处理温度达标事件"""
        print(f"[Scheduler] Temperature reached for room {event.room_id}")
        self.release_service(event.room_id)
        
        # 推送状态更新给前端
        await push_room_state(event.room_id)
        await push_system_event("target_reached", event.room_id, f"房间 {event.room_id} 达到目标温度")

    async def _handle_auto_restart(self, event: SchedulerEvent) -> None:
        """处理自动重启事件"""
        speed = event.payload.get("speed", "MID") if event.payload else "MID"
        print(f"[Scheduler] Auto restart for room {event.room_id} with speed {speed}")
        self.on_new_request(event.room_id, speed)
        
        # 推送状态更新给前端
        await push_room_state(event.room_id)
        await push_system_event("auto_restart", event.room_id, f"房间 {event.room_id} 自动重启送风")

    # ================== Public API ==================
    def on_new_request(self, room_id: str, speed: str) -> None:
        """处理新的空调服务请求"""
        self._remove_existing(room_id)
        service = ServiceObject(room_id=room_id, speed=speed)

        services = self._list_service_entries()
        print(f"[Scheduler] on_new_request: room={room_id}, speed={speed}")
        print(f"[Scheduler] current services: {len(services)}/{self.max_concurrent}")

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

        has_same_speed = any(s.speed == service.speed for s in services)
        print(f"[Scheduler] Has same speed in service queue: {has_same_speed}")
        self._enqueue_waiting(service, time_slice_enforced=has_same_speed)

    def on_request(self, room_id: str, speed: str) -> None:
        """处理请求（on_new_request 的别名）"""
        self.on_new_request(room_id, speed)

    def assign_service(self, service: ServiceObject) -> None:
        """将服务对象分配到服务队列"""
        service.status = ServiceStatus.SERVING
        service.started_at = service.started_at or datetime.utcnow()
        service.priority_token = 0
        service.time_slice_enforced = False
        
        # 向 TimeManager 申请服务计时器
        timer_handle = self.time_manager.create_service_timer(service.room_id, service.speed)
        service.attach_timer(timer_handle)
        
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
        
        # 取消计时任务
        service.cancel_timer()
        
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
        # 取消服务队列中的
        service = self._get_service_entry(room_id)
        if service:
            service.cancel_timer()
        if self.service_queue:
            self.service_queue.remove(room_id)
        
        # 取消等待队列中的
        wait_entry = self._get_wait_entry(room_id)
        if wait_entry:
            wait_entry.cancel_timer()
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
        victim.cancel_timer()
        self._close_detail_segment(victim.room_id)
        
        self._enqueue_waiting(victim, time_slice_enforced=False)
        self._boost_waiting_priority(new_service.speed)
        self.assign_service(new_service)

    # ================== 内部辅助方法 ==================
    def _remove_existing(self, room_id: str) -> None:
        """移除指定房间的现有服务/等待记录"""
        service = self._get_service_entry(room_id)
        if service:
            service.cancel_timer()
            self.release_service(room_id)
        wait_entry = self._get_wait_entry(room_id)
        if wait_entry:
            wait_entry.cancel_timer()
        if self.waiting_queue:
            self.waiting_queue.remove(room_id)

    def _enqueue_waiting(self, service: ServiceObject, *, time_slice_enforced: bool) -> None:
        """将服务对象加入等待队列"""
        service.time_slice_enforced = time_slice_enforced
        service.status = ServiceStatus.WAITING
        
        # 向 TimeManager 申请等待计时器
        timer_handle = self.time_manager.create_wait_timer(
            room_id=service.room_id,
            speed=service.speed,
            wait_seconds=self.time_slice_seconds,
            time_slice_enforced=time_slice_enforced
        )
        service.attach_timer(timer_handle)
        
        if self.waiting_queue:
            self.waiting_queue.add(service)
        
        room = self._room_lookup(service.room_id)
        if room:
            room.is_serving = False
            self._save_room(room)

    def _move_to_waiting(self, service: ServiceObject, *, time_slice_enforced: bool) -> None:
        """将服务对象从服务队列移到等待队列"""
        if self.service_queue:
            self.service_queue.remove(service.room_id)
        service.cancel_timer()
        self._close_detail_segment(service.room_id)
        
        service.time_slice_enforced = time_slice_enforced
        service.status = ServiceStatus.WAITING
        
        # 申请新的等待计时器
        timer_handle = self.time_manager.create_wait_timer(
            room_id=service.room_id,
            speed=service.speed,
            wait_seconds=self.time_slice_seconds,
            time_slice_enforced=time_slice_enforced
        )
        service.attach_timer(timer_handle)
        
        if self.waiting_queue:
            self.waiting_queue.add(service)
        
        room = self._room_lookup(service.room_id)
        if room:
            room.is_serving = False
            self._save_room(room)
        
        print(f"[Scheduler] Moved to waiting: room={service.room_id}, time_slice_enforced={time_slice_enforced}")

    def _fill_capacity_if_possible(self) -> None:
        """当服务队列有空位时，从等待队列提升服务"""
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
            next_service.cancel_timer()
            self.assign_service(next_service)

    def _boost_waiting_priority(self, new_speed: str) -> None:
        """提升等待队列中相同风速的优先级令牌"""
        wait_entries = self._list_wait_entries()
        for service in wait_entries:
            if service.speed == new_speed:
                service.priority_token += 1
                if self.waiting_queue:
                    self.waiting_queue.update(service)

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

    def _get_wait_entry(self, room_id: str) -> Optional[ServiceObject]:
        """根据房间 ID 获取等待队列中的条目"""
        if not self.waiting_queue:
            return None
        return self.waiting_queue.get(room_id)

    def _longest_served(self, services: List[ServiceObject]) -> Optional[ServiceObject]:
        """获取服务时间最长的服务对象"""
        if not services:
            return None
        return max(services, key=lambda s: s.served_seconds)

    def _select_highest_priority_waiting(self) -> Optional[ServiceObject]:
        """
        从等待队列中选择优先级最高的服务对象。
        
        优先级规则：
        1. 风速优先级：HIGH > MID > LOW
        2. 同风速时，优先级令牌高的优先
        3. 同令牌时，等待时间长的优先
        """
        wait_entries = self._list_wait_entries()
        if not wait_entries:
            return None
        return max(wait_entries, key=lambda s: s.priority_key())
