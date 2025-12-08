"""Shared singletons for settings, repository, scheduler, and services."""
from __future__ import annotations

from app.config import AppConfig, get_settings
from application.billing_service import BillingService
from application.scheduler import Scheduler
from application.use_ac_service import UseACService
from infrastructure.sqlite_repo import SQLiteRoomRepository

# 队列实现：可切换为 SQLite 实现
from domain.queues import ServiceQueue, WaitingQueue
# 默认使用 SQLite 队列以便接口可以直接查询 ServiceObject/WaitEntry 表，保持状态一致
from infrastructure.sqlite_queue import SQLiteServiceQueue, SQLiteWaitingQueue

settings = get_settings()

# 创建仓储
repository = SQLiteRoomRepository()

# 创建队列（使用 SQLite 实现，便于和 API 读取的状态保持一致）
service_queue: ServiceQueue = SQLiteServiceQueue()
waiting_queue: WaitingQueue = SQLiteWaitingQueue()
# 清理遗留的数据，保持与内存队列一致的“冷启动”体验
service_queue.clear()
waiting_queue.clear()

# 创建服务
billing_service = BillingService(settings, repository)
scheduler = Scheduler(settings)
scheduler.set_queues(service_queue, waiting_queue)  # 注入队列
scheduler.set_room_repository(repository)
scheduler.set_billing_service(billing_service)
ac_service = UseACService(settings, scheduler, repository, billing_service)


def apply_settings(new_settings: AppConfig) -> None:
	"""Update global settings reference and refresh dependent singletons."""
	global settings
	settings = new_settings
	billing_service.update_config(new_settings)
	scheduler.update_config(new_settings)
	ac_service.update_config(new_settings)


def reload_settings_from_disk() -> AppConfig:
	"""Force re-read of app_config.yaml and propagate changes."""
	get_settings.cache_clear()
	fresh = get_settings()
	apply_settings(fresh)
	return fresh
