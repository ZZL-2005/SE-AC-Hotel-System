"""调度器与时间管理器之间的事件定义 + 异步事件总线"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Coroutine, Dict, List, Optional
from uuid import uuid4


class EventType(str, Enum):
    """事件类型枚举"""
    # TimeManager → Scheduler (通知事件)
    TIME_SLICE_EXPIRED = "TIME_SLICE_EXPIRED"      # 等待时间片到期
    TEMPERATURE_REACHED = "TEMPERATURE_REACHED"    # 达到目标温度
    AUTO_RESTART_NEEDED = "AUTO_RESTART_NEEDED"    # 需要自动重启
    DETAIL_TIMEOUT = "DETAIL_TIMEOUT"              # 详单超时（预留）


@dataclass
class SchedulerEvent:
    """TimeManager 发送给 Scheduler 的事件"""
    event_type: EventType
    room_id: str
    payload: Optional[Dict[str, Any]] = None
    event_id: str = field(default_factory=lambda: str(uuid4()))


class AsyncEventBus:
    """
    异步事件总线 - 解决事件同步问题
    
    使用 asyncio.Queue 缓冲事件，消费者异步处理
    """
    
    def __init__(self, maxsize: int = 1000):
        self._queue: asyncio.Queue[SchedulerEvent] = asyncio.Queue(maxsize=maxsize)
        self._handlers: Dict[EventType, List[Callable[[SchedulerEvent], Coroutine[Any, Any, None]]]] = {}
        self._running: bool = False
        self._consumer_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()

    def register_handler(
        self, 
        event_type: EventType, 
        handler: Callable[[SchedulerEvent], Coroutine[Any, Any, None]]
    ) -> None:
        """注册事件处理器（异步函数）"""
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)

    def unregister_handler(
        self,
        event_type: EventType,
        handler: Callable[[SchedulerEvent], Coroutine[Any, Any, None]]
    ) -> None:
        """取消注册事件处理器"""
        if event_type in self._handlers:
            try:
                self._handlers[event_type].remove(handler)
            except ValueError:
                pass

    async def publish(self, event: SchedulerEvent) -> None:
        """发布事件到队列（异步，可等待）"""
        await self._queue.put(event)

    def publish_sync(self, event: SchedulerEvent) -> bool:
        """
        同步发布事件（供非异步上下文调用）
        
        返回 True 表示成功入队，False 表示队列满
        """
        try:
            self._queue.put_nowait(event)
            return True
        except asyncio.QueueFull:
            # 队列满时丢弃最旧的事件
            try:
                self._queue.get_nowait()
                self._queue.put_nowait(event)
                return True
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                return False

    async def _consume_loop(self) -> None:
        """事件消费循环"""
        while self._running:
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=0.1)
                handlers = self._handlers.get(event.event_type, [])
                for handler in handlers:
                    try:
                        await handler(event)
                    except Exception as e:
                        print(f"[EventBus] Handler error for {event.event_type}: {e}")
                self._queue.task_done()
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

    async def start(self) -> None:
        """启动事件消费循环"""
        if self._running:
            return
        self._running = True
        self._consumer_task = asyncio.create_task(self._consume_loop())
        print("[EventBus] Started")

    async def stop(self) -> None:
        """停止事件消费循环"""
        self._running = False
        if self._consumer_task:
            self._consumer_task.cancel()
            try:
                await self._consumer_task
            except asyncio.CancelledError:
                pass
            self._consumer_task = None
        print("[EventBus] Stopped")

    def pending_count(self) -> int:
        """待处理事件数量"""
        return self._queue.qsize()

    @property
    def is_running(self) -> bool:
        """是否正在运行"""
        return self._running

