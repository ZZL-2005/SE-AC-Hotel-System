"""Routers for front-desk workflows such as check-in/out."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import select

from interfaces import deps
from domain.room import Room, RoomStatus
from infrastructure.database import SessionLocal
from infrastructure.models import (
    AccommodationOrderModel,
    AccommodationBillModel,
    ServiceObjectModel,
    WaitEntryModel,
)

settings = deps.settings
repository = deps.repository
billing_service = deps.billing_service
scheduler = deps.scheduler
ac_service = deps.ac_service

router = APIRouter(tags=["frontdesk"])


class CheckInRequest(BaseModel):
    roomId: str = Field(..., alias="roomId")
    customerName: str
    nights: int = Field(..., ge=1)
    deposit: float = Field(0.0, ge=0.0)


class CheckOutRequest(BaseModel):
    roomId: str = Field(..., alias="roomId")


def _default_temperature() -> float:
    return float((settings.temperature or {}).get("default_target", 25.0))


def _accommodation_rate() -> float:
    return float((settings.accommodation or {}).get("rate_per_night", 300.0))


def _get_or_create_room(room_id: str) -> Room:
    room = repository.get_room(room_id)
    if room:
        return room
    default_temp = _default_temperature()
    new_room = Room(
        room_id=room_id,
        current_temp=default_temp,
        target_temp=default_temp,
        initial_temp=default_temp,
    )
    repository.save_room(new_room)
    return new_room


@router.post("/checkin")
def check_in(payload: CheckInRequest) -> Dict[str, Any]:
    room = _get_or_create_room(payload.roomId)
    scheduler.cancel_request(payload.roomId)
    billing_service.close_current_detail_record(payload.roomId, datetime.utcnow())

    initial_temp = room.current_temp
    room.initial_temp = initial_temp
    room.current_temp = initial_temp
    room.target_temp = initial_temp
    room.speed = "MID"
    room.total_fee = 0.0
    room.is_serving = False
    room.status = RoomStatus.OCCUPIED
    repository.save_room(room)

    order_id = str(uuid4())
    repository.add_accommodation_order(
        {
            "order_id": order_id,
            "room_id": payload.roomId,
            "customer_name": payload.customerName,
            "nights": payload.nights,
            "deposit": payload.deposit,
            "check_in_at": datetime.utcnow(),
        }
    )

    return {
        "orderId": order_id,
        "roomId": payload.roomId,
        "initialTemp": initial_temp,
        "nights": payload.nights,
        "deposit": payload.deposit,
        "status": "CHECKED_IN",
    }


@router.post("/checkout")
def check_out(payload: CheckOutRequest) -> Dict[str, Any]:
    room = repository.get_room(payload.roomId)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # Ensure service + wait entries cleaned and detail segments closed
    ac_service.power_off(payload.roomId)
    _remove_wait_entry(payload.roomId)

    order = _latest_accommodation_order(payload.roomId)
    if not order:
        raise HTTPException(status_code=400, detail="Room has no active accommodation order.")

    rate = _accommodation_rate()
    room_fee = float(order.nights) * rate
    deposit = float(order.deposit)

    ac_bill = billing_service.aggregate_records_to_bill(payload.roomId)
    ac_fee = ac_bill.total_fee if ac_bill else 0.0
    detail_records = ac_bill.details if ac_bill else []

    accommodation_bill_id = str(uuid4())
    accommodation_bill = {
        "bill_id": accommodation_bill_id,
        "room_id": payload.roomId,
        "total_fee": room_fee,
        "created_at": datetime.utcnow(),
    }
    repository.add_accommodation_bill(accommodation_bill)

    total_due = room_fee + ac_fee - deposit

    room.status = RoomStatus.VACANT
    room.is_serving = False
    room.speed = "MID"
    room.target_temp = _default_temperature()
    room.total_fee = 0.0
    repository.save_room(room)

    return {
        "roomId": payload.roomId,
        "accommodationBill": {
            "billId": accommodation_bill_id,
            "roomFee": room_fee,
            "nights": order.nights,
            "ratePerNight": rate,
            "deposit": deposit,
        },
        "acBill": _serialize_ac_bill(ac_bill),
        "detailRecords": [_serialize_detail(rec) for rec in detail_records],
        "totalDue": total_due,
    }


@router.get("/rooms/{room_id}/bills")
def get_room_bills(room_id: str) -> Dict[str, Any]:
    accommodation_bill = _latest_accommodation_bill(room_id)
    ac_bill = _latest_ac_bill(room_id)
    detail_records = ac_bill.details if ac_bill else []
    return {
        "roomId": room_id,
        "accommodationBill": _serialize_accommodation_bill(accommodation_bill),
        "acBill": _serialize_ac_bill(ac_bill),
        "detailRecords": [_serialize_detail(rec) for rec in detail_records],
    }


@router.get("/frontdesk/status")
def get_frontdesk_status() -> Dict[str, str]:
    return {"message": "Front desk API ready"}


def _remove_wait_entry(room_id: str) -> None:
    with SessionLocal() as session, session.begin():
        wait_model = session.get(WaitEntryModel, room_id)
        if wait_model:
            session.delete(wait_model)


def _latest_accommodation_order(room_id: str) -> Optional[AccommodationOrderModel]:
    with SessionLocal() as session:
        statement = (
            select(AccommodationOrderModel)
            .where(AccommodationOrderModel.room_id == room_id)
            .order_by(AccommodationOrderModel.check_in_at.desc())
        )
        return session.exec(statement).first()


def _latest_accommodation_bill(room_id: str) -> Optional[AccommodationBillModel]:
    with SessionLocal() as session:
        statement = (
            select(AccommodationBillModel)
            .where(AccommodationBillModel.room_id == room_id)
            .order_by(AccommodationBillModel.created_at.desc())
        )
        return session.exec(statement).first()


def _latest_ac_bill(room_id: str):
    bills = list(repository.list_ac_bills(room_id))
    return bills[-1] if bills else None


def _serialize_ac_bill(ac_bill) -> Optional[Dict[str, Any]]:
    if not ac_bill:
        return None
    return {
        "billId": ac_bill.bill_id,
        "roomId": ac_bill.room_id,
        "periodStart": ac_bill.period_start.isoformat(),
        "periodEnd": ac_bill.period_end.isoformat(),
        "totalFee": ac_bill.total_fee,
    }


def _serialize_accommodation_bill(model: Optional[AccommodationBillModel]) -> Optional[Dict[str, Any]]:
    if not model:
        return None
    return {
        "billId": model.bill_id,
        "roomId": model.room_id,
        "totalFee": model.total_fee,
        "createdAt": model.created_at.isoformat(),
    }


def _serialize_detail(record) -> Dict[str, Any]:
    return {
        "recordId": record.record_id,
        "roomId": record.room_id,
        "speed": record.speed,
        "startedAt": record.started_at.isoformat(),
        "endedAt": record.ended_at.isoformat() if record.ended_at else None,
        "ratePerMin": record.rate_per_min,
        "feeValue": record.fee_value,
    }
