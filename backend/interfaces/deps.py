"""Shared singletons for settings, repository, scheduler, and services.

根据 app_config.yaml 中的 storage 配置，自动选择数据库和队列的后端实现。
"""
from __future__ import annotations

from app.config import get_settings
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

# 创建服务
billing_service = BillingService(settings, repository)
scheduler = Scheduler(settings)
scheduler.set_queues(service_queue, waiting_queue)
scheduler.set_room_repository(repository)
scheduler.set_billing_service(billing_service)
ac_service = UseACService(settings, scheduler, repository, billing_service)
checkin_service = CheckInService(settings, repository, scheduler, billing_service)
checkout_service = CheckOutService(settings, repository, billing_service, ac_service)

# 打印当前使用的后端（便于调试）
print(f"[deps] Database backend: {settings.database_backend}")
print(f"[deps] Queue backend: {settings.queue_backend}")
