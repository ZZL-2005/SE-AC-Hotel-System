"""时间管理器 - 统一管理所有计时任务"""
from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Dict, Iterable, Optional, Set, TYPE_CHECKING

from app.config import AppConfig
from application.events import AsyncEventBus, SchedulerEvent, EventType
from application.timer_handle import TimerHandle, TimerType

if TYPE_CHECKING:
    from domain.room import Room
    from infrastructure.repository import RoomRepository


@dataclass
class TimerState:
    """计时器内部状态"""
    timer_id: str
    timer_type: TimerType
    room_id: str
    speed: Optional[str] = None
    elapsed_seconds: int = 0
    remaining_seconds: int = 0
    current_fee: float = 0.0
    time_slice_enforced: bool = False
    active: bool = True


@dataclass
class TimeManager:
    """
    时间管理器 - 统一管理所有计时任务
    
    职责：
    1. 管理服务计时器（SERVICE - 递增计时 + 计费）
    2. 管理等待计时器（WAIT - 倒计时 + 时间片轮转）
    3. 管理详单计时器（DETAIL - 记录空调使用时长）
    4. 管理入住计时器（ACCOMMODATION - 记录入住时长）
    5. 温度模拟与自动重启检测
    6. 通过异步事件总线向 Scheduler 发送通知
    """
    config: AppConfig
    event_bus: AsyncEventBus
    
    # 计时器存储
    _timers: Dict[str, TimerState] = field(default_factory=dict)
    _room_to_timer: Dict[str, Dict[TimerType, str]] = field(default_factory=dict)
    
    # tick 间隔（秒），用于控制时间流速
    _tick_interval: float = 1.0
    
    # 计费回调（由外部注入，避免循环依赖）
    _fee_callback: Optional[Callable[[str, str], float]] = None
    
    # 依赖注入
    _room_lookup: Callable[[str], Optional["Room"]] = field(default=lambda room_id: None)
    _iter_rooms: Callable[[], Iterable["Room"]] = field(default=lambda: [])
    _save_room: Callable[["Room"], None] = field(default=lambda room: None)
    
    # 时钟同步机制
    _tick_counter: int = field(default=0)
    _tick_event: threading.Event = field(default_factory=threading.Event)
    _tick_waiters: list = field(default_factory=list)  # asyncio.Event 列表
    
    # tick 后回调机制(用于快照采集等需要阻塞 tick 的操作)
    _post_tick_callback: Optional[Callable[[], Any]] = None
    _post_tick_event: Optional[asyncio.Event] = None
    
    # 链式等待支持(在 tick 回调中注册下一轮等待)
    _chained_wait_count: int = 0  # 下一轮要等待的 tick 数
    _chained_wait_event: Optional[asyncio.Event] = None  # 下一轮等待的事件
    _chained_wait_started_tick: int = -1  # 链式等待启动时的 tick 计数（用于跳过当前 tick）

    def __post_init__(self) -> None:
        self._reload_config()
        # 初始化房间到计时器的映射
        if not self._room_to_timer:
            self._room_to_timer = {}
        # 初始化时钟同步
        self._tick_counter = 0
        self._tick_event = threading.Event()
        self._tick_waiters = []

    def _reload_config(self) -> None:
        """从配置加载参数"""
        temp_cfg = self.config.temperature or {}
        self.auto_restart_threshold = float(temp_cfg.get("auto_restart_threshold", 1.0))
        scheduling_cfg = self.config.scheduling or {}
        self.time_slice_seconds = int(scheduling_cfg.get("time_slice_seconds", 60))
        throttle_cfg = self.config.throttle or {}
        self.throttle_ms = int(throttle_cfg.get("change_temp_ms", 1000))

    def update_config(self, config: AppConfig) -> None:
        """更新配置"""
        self.config = config
        self._reload_config()

    # ================== 依赖注入 ==================
    def set_fee_callback(self, callback: Callable[[str, str], float]) -> None:
        """设置计费回调（room_id, speed -> fee_increment）"""
        self._fee_callback = callback

    def set_room_repository(self, repo: "RoomRepository") -> None:
        """设置房间仓储"""
        self._room_lookup = repo.get_room
        self._iter_rooms = repo.list_rooms
        self._save_room = repo.save_room

    # ================== Tick 间隔控制 ==================
    def set_tick_interval(self, seconds: float) -> None:
        """
        设置 tick 间隔（秒）
        
        - 1.0 = 正常速度（1秒调用1次，推进1秒）
        - 0.1 = 10x 加速（0.1秒调用1次，推进1秒）
        - 0.01 = 100x 加速
        """
        if seconds <= 0:
            raise ValueError("tick_interval must be positive")
        self._tick_interval = seconds

    def get_tick_interval(self) -> float:
        """获取当前 tick 间隔"""
        return self._tick_interval

    # ================== 计时器创建 API ==================
    def create_service_timer(self, room_id: str, speed: str) -> TimerHandle:
        """
        创建服务计时器（SERVICE 类型）
        
        用于跟踪空调服务时长和费用累计
        """
        self._remove_timer_by_room(room_id, TimerType.SERVICE)
        
        handle = TimerHandle.create(TimerType.SERVICE, room_id, self)
        state = TimerState(
            timer_id=handle.timer_id,
            timer_type=TimerType.SERVICE,
            room_id=room_id,
            speed=speed,
            elapsed_seconds=0,
            current_fee=0.0,
            active=True
        )
        self._timers[handle.timer_id] = state
        self._set_room_timer(room_id, TimerType.SERVICE, handle.timer_id)
        return handle

    def create_wait_timer(
        self, 
        room_id: str, 
        speed: str,
        wait_seconds: int,
        time_slice_enforced: bool = False
    ) -> TimerHandle:
        """
        创建等待计时器（WAIT 类型）
        
        用于时间片轮转倒计时
        """
        self._remove_timer_by_room(room_id, TimerType.WAIT)
        
        handle = TimerHandle.create(TimerType.WAIT, room_id, self)
        state = TimerState(
            timer_id=handle.timer_id,
            timer_type=TimerType.WAIT,
            room_id=room_id,
            speed=speed,
            elapsed_seconds=0,
            remaining_seconds=wait_seconds,
            time_slice_enforced=time_slice_enforced,
            active=True
        )
        self._timers[handle.timer_id] = state
        self._set_room_timer(room_id, TimerType.WAIT, handle.timer_id)
        return handle

    def create_detail_timer(self, room_id: str, speed: str) -> TimerHandle:
        """
        创建详单计时器（DETAIL 类型）
        
        用于记录空调详单的使用时长
        """
        # 详单计时器不移除旧的，因为可能有多个详单段
        handle = TimerHandle.create(TimerType.DETAIL, room_id, self)
        state = TimerState(
            timer_id=handle.timer_id,
            timer_type=TimerType.DETAIL,
            room_id=room_id,
            speed=speed,
            elapsed_seconds=0,
            current_fee=0.0,
            active=True
        )
        self._timers[handle.timer_id] = state
        self._set_room_timer(room_id, TimerType.DETAIL, handle.timer_id)
        return handle

    def create_accommodation_timer(self, room_id: str) -> TimerHandle:
        """
        创建入住计时器（ACCOMMODATION 类型）
        
        用于记录入住时长
        """
        self._remove_timer_by_room(room_id, TimerType.ACCOMMODATION)
        
        handle = TimerHandle.create(TimerType.ACCOMMODATION, room_id, self)
        state = TimerState(
            timer_id=handle.timer_id,
            timer_type=TimerType.ACCOMMODATION,
            room_id=room_id,
            elapsed_seconds=0,
            active=True
        )
        self._timers[handle.timer_id] = state
        self._set_room_timer(room_id, TimerType.ACCOMMODATION, handle.timer_id)
        return handle

    # ================== 计时器恢复 API ==================
    def get_timer_by_id(self, timer_id: str) -> Optional[TimerHandle]:
        """
        通过 timer_id 获取句柄（用于从持久化恢复）
        """
        state = self._timers.get(timer_id)
        if not state or not state.active:
            return None
        return TimerHandle.restore(
            timer_id=state.timer_id,
            timer_type=state.timer_type,
            room_id=state.room_id,
            time_manager=self
        )

    def restore_timer(
        self,
        timer_id: str,
        timer_type: TimerType,
        room_id: str,
        speed: Optional[str] = None,
        elapsed_seconds: int = 0,
        remaining_seconds: int = 0,
        current_fee: float = 0.0,
        time_slice_enforced: bool = False
    ) -> TimerHandle:
        """
        从持久化数据恢复计时器状态
        """
        state = TimerState(
            timer_id=timer_id,
            timer_type=timer_type,
            room_id=room_id,
            speed=speed,
            elapsed_seconds=elapsed_seconds,
            remaining_seconds=remaining_seconds,
            current_fee=current_fee,
            time_slice_enforced=time_slice_enforced,
            active=True
        )
        self._timers[timer_id] = state
        self._set_room_timer(room_id, timer_type, timer_id)
        return TimerHandle.restore(timer_id, timer_type, room_id, self)

    # ================== 计时器查询 API ==================
    def has_timer(self, timer_id: str) -> bool:
        """检查计时器是否存在且有效"""
        state = self._timers.get(timer_id)
        return state is not None and state.active

    def get_elapsed_seconds(self, timer_id: str) -> int:
        """获取已经过的秒数"""
        state = self._timers.get(timer_id)
        return state.elapsed_seconds if state else 0

    def get_remaining_seconds(self, timer_id: str) -> int:
        """获取剩余秒数"""
        state = self._timers.get(timer_id)
        return state.remaining_seconds if state else 0

    def get_current_fee(self, timer_id: str) -> float:
        """获取当前累计费用"""
        state = self._timers.get(timer_id)
        return state.current_fee if state else 0.0

    def get_timer_speed(self, timer_id: str) -> Optional[str]:
        """获取计时器关联的风速"""
        state = self._timers.get(timer_id)
        return state.speed if state else None

    def get_timer_state(self, timer_id: str) -> Optional[TimerState]:
        """获取计时器完整状态（内部使用）"""
        return self._timers.get(timer_id)

    def cancel_timer(self, timer_id: str) -> None:
        """取消计时器"""
        state = self._timers.pop(timer_id, None)
        if state:
            self._remove_room_timer(state.room_id, state.timer_type)

    # ================== 内部辅助方法 ==================
    def _set_room_timer(self, room_id: str, timer_type: TimerType, timer_id: str) -> None:
        """设置房间到计时器的映射"""
        if room_id not in self._room_to_timer:
            self._room_to_timer[room_id] = {}
        self._room_to_timer[room_id][timer_type] = timer_id

    def _remove_room_timer(self, room_id: str, timer_type: TimerType) -> None:
        """移除房间到计时器的映射"""
        if room_id in self._room_to_timer:
            self._room_to_timer[room_id].pop(timer_type, None)

    def _remove_timer_by_room(self, room_id: str, timer_type: TimerType) -> None:
        """移除指定房间指定类型的计时器"""
        if room_id in self._room_to_timer:
            timer_id = self._room_to_timer[room_id].get(timer_type)
            if timer_id:
                self._timers.pop(timer_id, None)
                self._room_to_timer[room_id].pop(timer_type, None)

    def _get_active_service_rooms(self) -> Set[str]:
        """获取所有正在服务的房间ID"""
        return {
            state.room_id 
            for state in self._timers.values() 
            if state.timer_type == TimerType.SERVICE and state.active
        }

    def _get_active_wait_rooms(self) -> Set[str]:
        """获取所有等待中的房间ID"""
        return {
            state.room_id 
            for state in self._timers.values() 
            if state.timer_type == TimerType.WAIT and state.active
        }

    def _get_service_speeds(self) -> Set[str]:
        """获取服务队列中的所有风速"""
        return {
            state.speed 
            for state in self._timers.values() 
            if state.timer_type == TimerType.SERVICE and state.active and state.speed
        }

    # ================== 时钟推进 ==================
    def tick(self) -> None:
        """
        推进 1 秒逻辑时间
        
        调用间隔由 _tick_interval 控制，通过调整间隔实现时间加速
        """
        self._tick_service_timers()
        self._tick_wait_timers()
        self._tick_detail_timers()
        self._tick_accommodation_timers()
        self._tick_temperatures()
        self._tick_throttle_windows()
        self._check_auto_restart()
        
        # 时钟沿通知
        self._tick_counter += 1
        self._tick_event.set()  # 唤醒同步等待的线程
        self._tick_event.clear()
        
        # 唤醒异步等待者
        for waiter in self._tick_waiters:
            waiter.set()
        self._tick_waiters.clear()
        
        # 执行 tick 后回调(如果有)，阻塞当前 tick 直到回调完成
        if self._post_tick_callback and self._post_tick_event:
            try:
                # 调用回调函数
                self._post_tick_callback()
            finally:
                # 通知回调完成
                self._post_tick_event.set()
                self._post_tick_callback = None
                self._post_tick_event = None
        
        # 处理链式等待：如果有链式等待被注册，检查是否达到目标 tick 数
        if self._chained_wait_event and self._chained_wait_count > 0:
            # 跳过启动链式等待的那个 tick，从下一个 tick 开始计数
            if self._tick_counter > self._chained_wait_started_tick:
                self._chained_wait_count -= 1
                if self._chained_wait_count <= 0:
                    # 链式等待完成，通知等待者
                    self._chained_wait_event.set()
                    self._chained_wait_event = None
                    self._chained_wait_started_tick = -1

    def _tick_service_timers(self) -> None:
        """推进服务计时器"""
        for timer_id, state in list(self._timers.items()):
            if state.timer_type != TimerType.SERVICE or not state.active:
                continue
            
            state.elapsed_seconds += 1
            
            # 注意：服务计时器不再负责计费回调，避免与详单计时器重复
            # 费用累加由 _tick_detail_timers 处理
            
    def _tick_wait_timers(self) -> None:
        """推进等待计时器"""
        service_speeds = self._get_service_speeds()
        
        for timer_id, state in list(self._timers.items()):
            if state.timer_type != TimerType.WAIT or not state.active:
                continue
            
            state.elapsed_seconds += 1
            
            # 动态检测是否需要启用时间片轮转
            if not state.time_slice_enforced and state.speed in service_speeds:
                state.time_slice_enforced = True
                state.remaining_seconds = self.time_slice_seconds
            elif state.remaining_seconds > 0:
                state.remaining_seconds -= 1
            
            # 时间片到期，发送事件
            if state.remaining_seconds == 0 and state.time_slice_enforced:
                self.event_bus.publish_sync(SchedulerEvent(
                    event_type=EventType.TIME_SLICE_EXPIRED,
                    room_id=state.room_id,
                    payload={"speed": state.speed, "timer_id": timer_id}
                ))

    def _tick_detail_timers(self) -> None:
        """推进详单计时器"""
        for timer_id, state in list(self._timers.items()):
            if state.timer_type != TimerType.DETAIL or not state.active:
                continue
            state.elapsed_seconds += 1
            # 详单费用累加（如果需要）
            if self._fee_callback and state.speed:
                increment = self._fee_callback(state.room_id, state.speed)
                state.current_fee += increment
                
                # 同步更新对应的 SERVICE 计时器（只更新内存状态，不写库）
                # 这样 Scheduler 和监控接口能看到实时费用
                service_timer_id = self._room_to_timer.get(state.room_id, {}).get(TimerType.SERVICE)
                if service_timer_id:
                    service_timer = self._timers.get(service_timer_id)
                    if service_timer and service_timer.active:
                        service_timer.current_fee += increment

    def _tick_accommodation_timers(self) -> None:
        """推进入住计时器"""
        for timer_id, state in list(self._timers.items()):
            if state.timer_type != TimerType.ACCOMMODATION or not state.active:
                continue
            state.elapsed_seconds += 1

    def _tick_temperatures(self) -> None:
        """推进温度模拟"""
        temp_cfg = self.config.temperature or {}
        active_rooms = self._get_active_service_rooms()
        
        for room in self._iter_rooms():
            is_serving = room.room_id in active_rooms
            reached = room.tick_temperature(temp_cfg, serving=is_serving)
            self._save_room(room)
            
            # 达到目标温度，发送事件
            if reached and is_serving:
                self.event_bus.publish_sync(SchedulerEvent(
                    event_type=EventType.TEMPERATURE_REACHED,
                    room_id=room.room_id
                ))

    def _tick_throttle_windows(self) -> None:
        """应用节流窗口"""
        now = datetime.utcnow()
        for room in self._iter_rooms():
            room.apply_pending_target(now, self.throttle_ms)
            self._save_room(room)

    def _check_auto_restart(self) -> None:
        """检查是否需要自动重启"""
        from domain.room import RoomStatus
        
        active_rooms = self._get_active_service_rooms()
        waiting_rooms = self._get_active_wait_rooms()
        
        for room in self._iter_rooms():
            if room.status == RoomStatus.VACANT:
                continue
            if getattr(room, "manual_powered_off", False):
                continue
            if room.room_id in active_rooms or room.room_id in waiting_rooms:
                continue
            if room.needs_auto_restart(self.auto_restart_threshold):
                self.event_bus.publish_sync(SchedulerEvent(
                    event_type=EventType.AUTO_RESTART_NEEDED,
                    room_id=room.room_id,
                    payload={"speed": room.speed or "MID"}
                ))

    # ================== 调试接口 ==================
    def get_timer_stats(self) -> dict:
        """获取计时器统计信息（调试用）"""
        type_counts = {}
        for state in self._timers.values():
            t = state.timer_type.value
            type_counts[t] = type_counts.get(t, 0) + 1
        return {
            "total_timers": len(self._timers),
            "by_type": type_counts,
            "tick_interval": self._tick_interval,
            "tick_counter": self._tick_counter,
            "pending_events": self.event_bus.pending_count()
        }

    def list_timers(self) -> list:
        """列出所有计时器（调试用）"""
        return [
            {
                "timer_id": state.timer_id,
                "type": state.timer_type.value,
                "room_id": state.room_id,
                "speed": state.speed,
                "elapsed": state.elapsed_seconds,
                "remaining": state.remaining_seconds,
                "fee": state.current_fee,
                "active": state.active
            }
            for state in self._timers.values()
        ]

    # ================== 时钟同步接口 ==================
    def get_tick_counter(self) -> int:
        """获取当前 tick 计数（用于时钟同步）"""
        return self._tick_counter

    async def wait_for_next_tick(self, timeout: float = 5.0) -> bool:
        """
        等待下一个 tick 完成（异步接口）
        
        返回 True 表示成功等待，False 表示超时
        
        用法示例：
        ```python
        # 发送操作
        await ac_client.power_on(room_id)
        # 等待时钟推进
        await time_manager.wait_for_next_tick()
        # 读取快照
        snapshot = await monitor_client.fetch_rooms()
        ```
        """
        # 记录当前 tick 计数
        start_counter = self._tick_counter
        
        waiter = asyncio.Event()
        self._tick_waiters.append(waiter)
        
        try:
            await asyncio.wait_for(waiter.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            # 超时后从等待列表中移除
            if waiter in self._tick_waiters:
                self._tick_waiters.remove(waiter)
            
            # 检查是否实际上 tick 已经推进（可能是通知丢失）
            if self._tick_counter > start_counter:
                return True
            
            return False

    async def wait_for_ticks(self, count: int, timeout: float = 10.0) -> bool:
        """
        等待指定数量的 tick 完成
        
        参数：
        - count: 要等待的 tick 数量
        - timeout: 总超时时间（秒）
        
        返回 True 表示成功等待，False 表示超时
        """
        # 为每个 tick 留出充裕的缓冲时间，避免因处理延迟而超时
        # 每个 tick 的超时 = max(3秒, 总超时 / count * 3)
        per_tick_timeout = max(10.0, timeout / count * 3)
        
        for i in range(count):
            if not await self.wait_for_next_tick(timeout=per_tick_timeout):
                return False
        return True
    
    async def wait_for_ticks_with_callback(self, count: int, callback: Callable[[], Any], timeout: float = 10.0) -> bool:
        """
        等待指定数量的 tick 完成，并在最后一个 tick 完成后立即执行回调(阻塞 tick)
        
        参数：
        - count: 要等待的 tick 数量
        - callback: tick 完成后立即执行的回调函数(在 tick 线程中同步执行)
        - timeout: 总超时时间（秒）
        
        返回 True 表示成功，False 表示超时
        
        注意：回调函数在 tick 线程中执行，会阻塞下一个 tick，确保时间完全同步
        """
        # 等待前 count-1 个 tick
        if count > 1:
            if not await self.wait_for_ticks(count - 1, timeout=timeout * 0.9):
                return False
        
        # 注册回调，在下一个 tick 完成后立即执行
        callback_event = asyncio.Event()
        self._post_tick_callback = callback
        self._post_tick_event = callback_event
        
        # 等待最后一个 tick 完成
        last_tick_timeout = max(5.0, timeout * 0.1)
        if not await self.wait_for_next_tick(timeout=last_tick_timeout):
            # 超时，清理回调
            self._post_tick_callback = None
            self._post_tick_event = None
            return False
        
        # 等待回调执行完成
        try:
            await asyncio.wait_for(callback_event.wait(), timeout=last_tick_timeout)
            return True
        except asyncio.TimeoutError:
            return False
    
    def start_chained_wait(self, count: int) -> None:
        """
        在 tick 回调中启动链式等待，立即注册下一轮等待
        
        此方法应在 tick 回调中调用，以确保下一轮等待从下一个 tick 开始，
        避免在响应返回和下一次请求之间漏过 tick。
        
        参数:
        - count: 要等待的 tick 数量
        
        注意：计数从下一个 tick 开始，当前 tick 不计入。
        """
        if count <= 0:
            return
        
        # 记录当前 tick 计数作为起始点，从下一个 tick 开始计数
        self._chained_wait_count = count
        self._chained_wait_event = asyncio.Event()
        self._chained_wait_started_tick = self._tick_counter  # 记录启动时的 tick，用于跳过当前 tick
    
    async def wait_for_chained_ticks(self, timeout: float = 10.0) -> bool:
        """
        等待链式等待完成
        
        此方法应在下一次 HTTP 请求中调用，以获取上一次链式等待的结果。
        
        返回 True 表示成功，False 表示超时或无链式等待。
        """
        if self._chained_wait_event is None or self._chained_wait_count <= 0:
            return False
        
        event = self._chained_wait_event
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            # 清理链式等待状态
            self._chained_wait_count = 0
            self._chained_wait_event = None
            self._chained_wait_started_tick = -1

