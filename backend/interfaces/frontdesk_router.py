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

repository = deps.repository
billing_service = deps.billing_service
scheduler = deps.scheduler
ac_service = deps.ac_service

router = APIRouter(tags=["frontdesk"])

checkin_service = deps.checkin_service
checkout_service = deps.checkout_service


class CheckInRequest(BaseModel):
    """
    对应 SSD 系统事件序列：
    1. Registe_CustomerInfo(Cust_Id, Cust_name, number, date)
    2. Check_RoomState(date) - 前端房间选择器实现
    3. Create_Accommodation_Order(Customer_id, Room_id)
    4. deposite(amount) - 可选
    """
    custId: str = Field(..., description="Cust_Id - 顾客身份证号")
    custName: str = Field(..., description="Cust_name - 顾客姓名")
    guestCount: int = Field(1, ge=1, description="number - 入住人数")
    checkInDate: str = Field(..., description="date - 入住日期")
    roomId: str = Field(..., description="Room_id - 房间号")
    deposit: float = Field(0.0, ge=0.0, description="amount - 押金（可选）")


class CheckOutRequest(BaseModel):
    roomId: str = Field(..., alias="roomId")


def _default_temperature() -> float:
    return float((deps.settings.temperature or {}).get("default_target", 25.0))


def _accommodation_rate(room_id: Optional[str] = None) -> float:
    if room_id:
        room = repository.get_room(room_id)
        if room and room.rate_per_night:
            return room.rate_per_night
    return float((deps.settings.accommodation or {}).get("rate_per_night", 300.0))


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


def _remove_wait_entry(room_id: str) -> None:
    """移除等待队列条目"""
    with SessionLocal() as session:
        model = session.get(WaitEntryModel, room_id)
        if model:
            session.delete(model)
            session.commit()


def _latest_accommodation_order(room_id: str) -> Optional[AccommodationOrderModel]:
    """获取最新的入住订单"""
    with SessionLocal() as session:
        statement = (
            select(AccommodationOrderModel)
            .where(AccommodationOrderModel.room_id == room_id)
            .order_by(AccommodationOrderModel.check_in_at.desc())
        )
        return session.exec(statement).first()


def _serialize_ac_bill(ac_bill) -> Optional[Dict[str, Any]]:
    """序列化空调账单"""
    if not ac_bill:
        return None
    return {
        "billId": ac_bill.bill_id,
        "roomId": ac_bill.room_id,
        "periodStart": ac_bill.period_start.isoformat(),
        "periodEnd": ac_bill.period_end.isoformat(),
        "totalFee": ac_bill.total_fee,
    }


def _serialize_detail(rec) -> Dict[str, Any]:
    """序列化详单记录"""
    return {
        "recordId": rec.record_id,
        "roomId": rec.room_id,
        "speed": rec.speed,
        "startedAt": rec.started_at.isoformat(),
        "endedAt": rec.ended_at.isoformat() if rec.ended_at else None,
        "ratePerMin": rec.rate_per_min,
        "feeValue": rec.fee_value,
    }


@router.post("/checkin")
def check_in(payload: CheckInRequest) -> Dict[str, Any]:
    """
    办理入住登记。
    """
    return checkin_service.check_in(
        room_id=payload.roomId,
        cust_id=payload.custId,
        cust_name=payload.custName,
        guest_count=payload.guestCount,
        check_in_date_str=payload.checkInDate,
        deposit=payload.deposit,
    )


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

    rate = _accommodation_rate(payload.roomId)
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
    """
    获取房间账单信息。
    """
    return checkout_service.get_room_bills(room_id)


@router.get("/frontdesk/status")
def get_frontdesk_status() -> Dict[str, str]:
    return {"message": "Front desk API ready"}
