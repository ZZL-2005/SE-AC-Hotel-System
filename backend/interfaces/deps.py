"""Shared singletons for settings, repository, scheduler, and services."""
from __future__ import annotations

from app.config import get_settings
from application.billing_service import BillingService
from application.scheduler import Scheduler
from application.use_ac_service import UseACService
from infrastructure.sqlite_repo import SQLiteRoomRepository

settings = get_settings()
repository = SQLiteRoomRepository()
billing_service = BillingService(settings, repository)
scheduler = Scheduler(settings)
scheduler.set_room_repository(repository)
scheduler.set_billing_service(billing_service)
ac_service = UseACService(settings, scheduler, repository, billing_service)
