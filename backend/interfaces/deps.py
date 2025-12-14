"""Shared singletons for settings, repository, scheduler, and services.

根据 app_config.yaml 中的 storage 配置，自动选择数据库和队列的后端实现。
"""
from __future__ import annotations

from app.config import AppConfig, get_settings
from application.events import AsyncEventBus
from application.time_manager import TimeManager
from application.billing_service import BillingService
from application.scheduler import Scheduler
from application.use_ac_service import UseACService
from application.checkin_service import CheckInService
from application.checkout_service import CheckOutService

# 数据库实现
from infrastructure.sqlite_repo import SQLiteRoomRepository
from infrastructure.memory_store import InMemoryRoomRepository
from infrastructure.repository import RoomRepository

# 队列实现
from domain.queues import ServiceQueue, WaitingQueue
from infrastructure.memory_queue import InMemoryServiceQueue, InMemoryWaitingQueue
# 默认使用 SQLite 队列以便接口可以直接查询 ServiceObject/WaitEntry 表，保持状态一致
from infrastructure.sqlite_queue import SQLiteServiceQueue, SQLiteWaitingQueue

settings = get_settings()


def _create_repository() -> RoomRepository:
    """根据配置创建数据库仓储实例"""
    backend = settings.database_backend
    if backend == "memory":
        return InMemoryRoomRepository()
    elif backend == "sqlite":
        return SQLiteRoomRepository()
    else:
        raise ValueError(f"Unknown database backend: {backend}. Supported: sqlite, memory")


def _create_queues() -> tuple[ServiceQueue, WaitingQueue]:
    """根据配置创建队列实例"""
    backend = settings.queue_backend
    if backend == "memory":
        return InMemoryServiceQueue(), InMemoryWaitingQueue()
    elif backend == "sqlite":
        return SQLiteServiceQueue(), SQLiteWaitingQueue()
    else:
        raise ValueError(f"Unknown queue backend: {backend}. Supported: sqlite, memory")


# 根据配置创建仓储和队列
repository = _create_repository()
service_queue, waiting_queue = _create_queues()
# 清理遗留的数据，保持与内存队列一致的"冷启动"体验
service_queue.clear()
waiting_queue.clear()

# 创建异步事件总线
event_bus = AsyncEventBus()

# 创建时间管理器
time_manager = TimeManager(settings, event_bus)

# 创建计费服务（先创建，后设置 TimeManager）
billing_service = BillingService(settings, repository)
billing_service.set_time_manager(time_manager)

# 创建调度器
scheduler = Scheduler(settings, time_manager, event_bus)
scheduler.set_queues(service_queue, waiting_queue)
scheduler.set_room_repository(repository)
scheduler.set_billing_service(billing_service)

# 设置 TimeManager 对 Scheduler 的引用（用于获取锁）
time_manager.set_scheduler(scheduler)

# 创建空调服务
ac_service = UseACService(settings, scheduler, repository, billing_service)

# 创建入住/退房服务
checkin_service = CheckInService(settings, repository, scheduler, billing_service, time_manager)
checkout_service = CheckOutService(settings, repository, billing_service, ac_service, time_manager)

# 打印当前使用的后端（便于调试）
print(f"[deps] Database backend: {settings.database_backend}")
print(f"[deps] Queue backend: {settings.queue_backend}")
print(f"[deps] EventBus and TimeManager initialized")


def apply_settings(new_settings: AppConfig) -> None:
    """Update global settings reference and refresh dependent singletons."""
    global settings
    settings = new_settings
    billing_service.update_config(new_settings)
    scheduler.update_config(new_settings)
    ac_service.update_config(new_settings)
    time_manager.update_config(new_settings)


def reload_settings_from_disk() -> AppConfig:
    """Force re-read of app_config.yaml and propagate changes."""
    get_settings.cache_clear()
    fresh = get_settings()
    apply_settings(fresh)
    return fresh
