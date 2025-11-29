"""Shared singletons for settings, repository, scheduler, and services."""
from __future__ import annotations

from app.config import get_settings
from application.billing_service import BillingService
from application.scheduler import Scheduler
from application.use_ac_service import UseACService
from infrastructure.sqlite_repo import SQLiteRoomRepository

# 队列实现：可切换为 SQLite 实现
from domain.queues import ServiceQueue, WaitingQueue
from infrastructure.memory_queue import InMemoryServiceQueue, InMemoryWaitingQueue
# from infrastructure.sqlite_queue import SQLiteServiceQueue, SQLiteWaitingQueue

settings = get_settings()

# 创建仓储
repository = SQLiteRoomRepository()

# 创建队列（使用内存实现，可切换为 SQLite 实现）
service_queue: ServiceQueue = InMemoryServiceQueue()
waiting_queue: WaitingQueue = InMemoryWaitingQueue()
# service_queue: ServiceQueue = SQLiteServiceQueue()  # SQLite 实现
# waiting_queue: WaitingQueue = SQLiteWaitingQueue()  # SQLite 实现

# 创建服务
billing_service = BillingService(settings, repository)
scheduler = Scheduler(settings)
scheduler.set_queues(service_queue, waiting_queue)  # 注入队列
scheduler.set_room_repository(repository)
scheduler.set_billing_service(billing_service)
ac_service = UseACService(settings, scheduler, repository, billing_service)
