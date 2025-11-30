"""SQLite 队列实现，支持数据持久化，服务重启后可恢复状态。"""
from __future__ import annotations

from typing import List, Optional

from sqlmodel import select

from domain.queues import ServiceQueue, WaitingQueue
from domain.service_object import ServiceObject, ServiceStatus
from .database import SessionLocal
from .models import ServiceObjectModel, WaitEntryModel


class SQLiteServiceQueue(ServiceQueue):
    """服务队列的 SQLite 实现"""

    def add(self, service: ServiceObject) -> None:
        with SessionLocal() as session:
            model = self._to_model(service)
            session.merge(model)
            session.commit()

    def remove(self, room_id: str) -> None:
        with SessionLocal() as session:
            model = session.get(ServiceObjectModel, room_id)
            if model:
                session.delete(model)
                session.commit()

    def get(self, room_id: str) -> Optional[ServiceObject]:
        with SessionLocal() as session:
            model = session.get(ServiceObjectModel, room_id)
            return self._to_entity(model) if model else None

    def list_all(self) -> List[ServiceObject]:
        with SessionLocal() as session:
            models = session.exec(select(ServiceObjectModel)).all()
            return [self._to_entity(m) for m in models]

    def update(self, service: ServiceObject) -> None:
        self.add(service)  # merge 会自动处理更新

    def size(self) -> int:
        with SessionLocal() as session:
            models = session.exec(select(ServiceObjectModel)).all()
            return len(models)

    def clear(self) -> None:
        with SessionLocal() as session:
            models = session.exec(select(ServiceObjectModel)).all()
            for model in models:
                session.delete(model)
            session.commit()

    def _to_model(self, service: ServiceObject) -> ServiceObjectModel:
        return ServiceObjectModel(
            room_id=service.room_id,
            speed=service.speed,
            started_at=service.started_at,
            served_seconds=service.served_seconds,
            wait_seconds=service.wait_seconds,
            total_waited_seconds=service.total_waited_seconds,
            priority_token=service.priority_token,
            time_slice_enforced=service.time_slice_enforced,
            status=service.status.value if isinstance(service.status, ServiceStatus) else service.status,
            current_fee=service.current_fee,
        )

    def _to_entity(self, model: ServiceObjectModel) -> ServiceObject:
        return ServiceObject(
            room_id=model.room_id,
            speed=model.speed,
            started_at=model.started_at,
            served_seconds=model.served_seconds,
            wait_seconds=model.wait_seconds,
            total_waited_seconds=model.total_waited_seconds,
            priority_token=model.priority_token,
            time_slice_enforced=model.time_slice_enforced,
            status=ServiceStatus(model.status) if model.status else ServiceStatus.WAITING,
            current_fee=model.current_fee,
        )


class SQLiteWaitingQueue(WaitingQueue):
    """等待队列的 SQLite 实现"""

    def add(self, service: ServiceObject) -> None:
        with SessionLocal() as session:
            model = self._to_model(service)
            session.merge(model)
            session.commit()

    def remove(self, room_id: str) -> None:
        with SessionLocal() as session:
            model = session.get(WaitEntryModel, room_id)
            if model:
                session.delete(model)
                session.commit()

    def get(self, room_id: str) -> Optional[ServiceObject]:
        with SessionLocal() as session:
            model = session.get(WaitEntryModel, room_id)
            return self._to_entity(model) if model else None

    def list_all(self) -> List[ServiceObject]:
        with SessionLocal() as session:
            models = session.exec(select(WaitEntryModel)).all()
            return [self._to_entity(m) for m in models]

    def update(self, service: ServiceObject) -> None:
        self.add(service)  # merge 会自动处理更新

    def size(self) -> int:
        with SessionLocal() as session:
            models = session.exec(select(WaitEntryModel)).all()
            return len(models)

    def clear(self) -> None:
        with SessionLocal() as session:
            models = session.exec(select(WaitEntryModel)).all()
            for model in models:
                session.delete(model)
            session.commit()

    def _to_model(self, service: ServiceObject) -> WaitEntryModel:
        return WaitEntryModel(
            room_id=service.room_id,
            speed=service.speed,
            wait_seconds=service.wait_seconds,
            total_waited_seconds=service.total_waited_seconds,
            priority_token=service.priority_token,
            time_slice_enforced=service.time_slice_enforced,
        )

    def _to_entity(self, model: WaitEntryModel) -> ServiceObject:
        return ServiceObject(
            room_id=model.room_id,
            speed=model.speed,
            wait_seconds=model.wait_seconds,
            total_waited_seconds=model.total_waited_seconds,
            priority_token=model.priority_token,
            time_slice_enforced=model.time_slice_enforced,
            status=ServiceStatus.WAITING,
        )

