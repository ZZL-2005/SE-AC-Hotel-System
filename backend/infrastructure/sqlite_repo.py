"""SQLite-backed repository implementation."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Iterable, List, Optional, TYPE_CHECKING

from sqlmodel import select

from domain.room import Room, RoomStatus
from domain.detail_record import ACDetailRecord
from domain.bill import ACBill
from .repository import RoomRepository
from .database import SessionLocal, init_db
from .models import (
    RoomModel,
    ServiceObjectModel,
    WaitEntryModel,
    ACDetailRecordModel,
    ACBillModel,
    AccommodationOrderModel,
    AccommodationBillModel,
    MealOrderModel,
)

if TYPE_CHECKING:  # pragma: no cover
    from domain.service_object import ServiceObject


class SQLiteRoomRepository(RoomRepository):
    def __init__(self):
        init_db()

    # Rooms ----------------------------------------------------------------
    def get_room(self, room_id: str) -> Optional[Room]:
        with SessionLocal() as session:
            model = session.get(RoomModel, room_id)
            if not model:
                return None
            return self._room_from_model(model)

    def list_rooms(self) -> Iterable[Room]:
        with SessionLocal() as session:
            models = session.exec(select(RoomModel)).all()
            for model in models:
                yield self._room_from_model(model)

    def save_room(self, room: Room) -> None:
        with SessionLocal() as session:
            with session.begin():
                model = session.get(RoomModel, room.room_id)
                if not model:
                    model = RoomModel(room_id=room.room_id)
                model.status = room.status.value
                model.current_temp = room.current_temp
                model.target_temp = room.target_temp
                model.initial_temp = room.initial_temp
                model.mode = room.mode
                model.speed = room.speed
                model.is_serving = room.is_serving
                model.total_fee = room.total_fee
                model.rate_per_night = room.rate_per_night
                model.active_service_id = room.active_service_id
                model.last_temp_change_timestamp = room.last_temp_change_timestamp
                model.pending_target_temp = room.pending_target_temp
                model.manual_powered_off = room.manual_powered_off
                session.add(model)

    # Service objects ------------------------------------------------------
    def add_service_object(self, service: "ServiceObject") -> None:
        with SessionLocal() as session, session.begin():
            session.add(self._service_model_from_service(service))

    def update_service_object(self, service: "ServiceObject") -> None:
        with SessionLocal() as session, session.begin():
            model = session.get(ServiceObjectModel, service.room_id)
            if not model:
                model = self._service_model_from_service(service)
            else:
                self._populate_service_model(model, service)
            session.add(model)

    def remove_service_object(self, room_id: str) -> None:
        with SessionLocal() as session, session.begin():
            model = session.get(ServiceObjectModel, room_id)
            if model:
                session.delete(model)

    # Waiting queue -------------------------------------------------------
    def add_wait_entry(self, service: "ServiceObject") -> None:
        with SessionLocal() as session, session.begin():
            model = WaitEntryModel(
                room_id=service.room_id,
                speed=service.speed,
                wait_seconds=service.wait_seconds,
                total_waited_seconds=service.total_waited_seconds,
                priority_token=service.priority_token,
            )
            session.merge(model)

    def remove_wait_entry(self, room_id: str) -> None:
        with SessionLocal() as session, session.begin():
            model = session.get(WaitEntryModel, room_id)
            if model:
                session.delete(model)

    def list_wait_entries(self) -> Iterable["ServiceObject"]:
        with SessionLocal() as session:
            models = session.exec(select(WaitEntryModel)).all()
            for model in models:
                yield self._service_object_from_wait(model)

    # Billing --------------------------------------------------------------
    def add_detail_record(self, record: ACDetailRecord) -> None:
        with SessionLocal() as session, session.begin():
            model = ACDetailRecordModel(
                record_id=record.record_id,
                room_id=record.room_id,
                speed=record.speed,
                started_at=record.started_at,
                ended_at=record.ended_at,
                logic_start_seconds=record.logic_start_seconds,
                logic_end_seconds=record.logic_end_seconds,
                rate_per_min=record.rate_per_min,
                fee_value=record.fee_value,
                timer_id=record.timer_id,
            )
            session.add(model)

    def update_detail_record(self, record: ACDetailRecord) -> None:
        with SessionLocal() as session, session.begin():
            model = session.get(ACDetailRecordModel, record.record_id)
            if not model:
                model = ACDetailRecordModel(record_id=record.record_id, room_id=record.room_id)
            model.speed = record.speed
            model.started_at = record.started_at
            model.ended_at = record.ended_at
            model.logic_start_seconds = record.logic_start_seconds
            model.logic_end_seconds = record.logic_end_seconds
            model.rate_per_min = record.rate_per_min
            model.fee_value = record.fee_value
            model.timer_id = record.timer_id
            session.add(model)

    def get_active_detail_record(self, room_id: str) -> Optional[ACDetailRecord]:
        with SessionLocal() as session:
            statement = (
                select(ACDetailRecordModel)
                .where(ACDetailRecordModel.room_id == room_id)
                .where(ACDetailRecordModel.ended_at.is_(None))
                .order_by(ACDetailRecordModel.started_at.desc())
            )
            model = session.exec(statement).first()
            if not model:
                return None
            return self._detail_from_model(model)

    def list_completed_detail_records(self, room_id: str) -> Iterable[ACDetailRecord]:
        with SessionLocal() as session:
            statement = (
                select(ACDetailRecordModel)
                .where(ACDetailRecordModel.room_id == room_id)
                .where(ACDetailRecordModel.ended_at.is_not(None))
            )
            models = session.exec(statement).all()
            for model in models:
                yield self._detail_from_model(model)

    def add_ac_bill(self, bill: ACBill) -> None:
        with SessionLocal() as session, session.begin():
            model = ACBillModel(
                bill_id=bill.bill_id,
                room_id=bill.room_id,
                period_start=bill.period_start,
                period_end=bill.period_end,
                total_fee=bill.total_fee,
            )
            session.add(model)

    def list_ac_bills(self, room_id: str) -> Iterable[ACBill]:
        with SessionLocal() as session:
            statement = select(ACBillModel).where(ACBillModel.room_id == room_id)
            models = session.exec(statement).all()
            for model in models:
                details_stmt = (
                    select(ACDetailRecordModel)
                    .where(ACDetailRecordModel.room_id == room_id)
                    .where(ACDetailRecordModel.started_at >= model.period_start)
                    .where(ACDetailRecordModel.ended_at <= model.period_end)
                )
                detail_models = session.exec(details_stmt).all()
                yield ACBill(
                    bill_id=model.bill_id,
                    room_id=model.room_id,
                    period_start=model.period_start,
                    period_end=model.period_end,
                    total_fee=model.total_fee,
                    details=[self._detail_from_model(detail) for detail in detail_models],
                )

    # Accommodation -------------------------------------------------------
    def add_accommodation_order(self, order: dict) -> None:
        with SessionLocal() as session, session.begin():
            session.add(
                AccommodationOrderModel(
                    order_id=order["order_id"],
                    room_id=order["room_id"],
                    customer_name=order["customer_name"],
                    nights=order["nights"],
                    deposit=order["deposit"],
                    check_in_at=order["check_in_at"],
                    timer_id=order.get("timer_id"),
                )
            )

    def get_latest_accommodation_order(self, room_id: str) -> Optional[dict]:
        with SessionLocal() as session:
            statement = (
                select(AccommodationOrderModel)
                .where(AccommodationOrderModel.room_id == room_id)
                .order_by(AccommodationOrderModel.check_in_at.desc())
            )
            model = session.exec(statement).first()
            if not model:
                return None
            return {
                "order_id": model.order_id,
                "room_id": model.room_id,
                "customer_name": model.customer_name,
                "nights": model.nights,
                "deposit": model.deposit,
                "check_in_at": model.check_in_at,
                "timer_id": model.timer_id,
            }

    def add_accommodation_bill(self, bill: dict) -> None:
        with SessionLocal() as session, session.begin():
            session.add(
                AccommodationBillModel(
                    bill_id=bill["bill_id"],
                    room_id=bill["room_id"],
                    total_fee=bill["total_fee"],
                    created_at=bill["created_at"],
                )
            )

    def get_latest_accommodation_bill(self, room_id: str) -> Optional[dict]:
        with SessionLocal() as session:
            statement = (
                select(AccommodationBillModel)
                .where(AccommodationBillModel.room_id == room_id)
                .order_by(AccommodationBillModel.created_at.desc())
            )
            model = session.exec(statement).first()
            if not model:
                return None
            return {
                "bill_id": model.bill_id,
                "room_id": model.room_id,
                "total_fee": model.total_fee,
                "created_at": model.created_at,
            }

    # Meal orders ---------------------------------------------------------
    def add_meal_order(self, order: dict) -> None:
        with SessionLocal() as session, session.begin():
            session.add(
                MealOrderModel(
                    order_id=order["order_id"],
                    room_id=order["room_id"],
                    items_json=json.dumps(order["items"], ensure_ascii=False),
                    total_fee=order["total_fee"],
                    note=order.get("note"),
                    created_at=order["created_at"],
                )
            )

    def list_meal_orders(self, room_id: str, since: Optional[datetime] = None) -> Iterable[dict]:
        with SessionLocal() as session:
            statement = (
                select(MealOrderModel)
                .where(MealOrderModel.room_id == room_id)
                .order_by(MealOrderModel.created_at.asc())
            )
            if since:
                statement = statement.where(MealOrderModel.created_at >= since)
            models = session.exec(statement).all()
            for model in models:
                yield {
                    "order_id": model.order_id,
                    "room_id": model.room_id,
                    "items": json.loads(model.items_json),
                    "total_fee": model.total_fee,
                    "note": model.note,
                    "created_at": model.created_at,
                }

    def get_meal_total_fee(self, room_id: str, since: Optional[datetime] = None) -> float:
        with SessionLocal() as session:
            statement = (
                select(MealOrderModel)
                .where(MealOrderModel.room_id == room_id)
            )
            if since:
                statement = statement.where(MealOrderModel.created_at >= since)
            models = session.exec(statement).all()
            return sum(model.total_fee for model in models)

    # Helpers --------------------------------------------------------------
    def _room_from_model(self, model: RoomModel) -> Room:
        return Room(
            room_id=model.room_id,
            status=RoomStatus(model.status),
            current_temp=model.current_temp,
            target_temp=model.target_temp,
            initial_temp=model.initial_temp,
            mode=model.mode,
            speed=model.speed,
            is_serving=model.is_serving,
            total_fee=model.total_fee,
            rate_per_night=model.rate_per_night,
            active_service_id=model.active_service_id,
            last_temp_change_timestamp=model.last_temp_change_timestamp,
            pending_target_temp=model.pending_target_temp,
            manual_powered_off=model.manual_powered_off,
            metadata={},
        )

    def _service_model_from_service(self, service: "ServiceObject") -> ServiceObjectModel:
        model = ServiceObjectModel(room_id=service.room_id)
        self._populate_service_model(model, service)
        return model

    def _populate_service_model(self, model: ServiceObjectModel, service: "ServiceObject") -> None:
        model.speed = service.speed
        model.started_at = service.started_at
        model.served_seconds = service.served_seconds
        model.wait_seconds = service.wait_seconds
        model.total_waited_seconds = service.total_waited_seconds
        model.priority_token = service.priority_token
        model.time_slice_enforced = service.time_slice_enforced
        model.status = service.status
        model.current_fee = service.current_fee

    def _service_object_from_wait(self, model: WaitEntryModel) -> "ServiceObject":
        from domain.service_object import ServiceObject, ServiceStatus

        return ServiceObject(
            room_id=model.room_id,
            speed=model.speed,
            wait_seconds=model.wait_seconds,
            total_waited_seconds=model.total_waited_seconds,
            priority_token=model.priority_token,
            status=ServiceStatus.WAITING,
        )

    def _detail_from_model(self, model: ACDetailRecordModel) -> ACDetailRecord:
        return ACDetailRecord(
            record_id=model.record_id,
            room_id=model.room_id,
            speed=model.speed,
            started_at=model.started_at,
            ended_at=model.ended_at,
            logic_start_seconds=model.logic_start_seconds,
            logic_end_seconds=model.logic_end_seconds,
            rate_per_min=model.rate_per_min,
            fee_value=model.fee_value,
            timer_id=model.timer_id,
        )
