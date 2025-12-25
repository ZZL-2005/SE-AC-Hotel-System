"""Routers for front-desk workflows such as check-in/out."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
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


class MealItem(BaseModel):
    id: str
    name: str
    price: float
    qty: int


class MealOrderRequest(BaseModel):
    items: List[MealItem]
    note: Optional[str] = None


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
    try:
        return checkout_service.check_out(payload.roomId)
    except ValueError as exc:
        detail = str(exc)
        if "not found" in detail.lower():
            raise HTTPException(status_code=404, detail=detail) from exc
        raise HTTPException(status_code=400, detail=detail) from exc


@router.get("/rooms/{room_id}/bills")
def get_room_bills(room_id: str) -> Dict[str, Any]:
    """
    获取房间账单信息。
    """
    return checkout_service.get_room_bills(room_id)


@router.get("/frontdesk/status")
def get_frontdesk_status() -> Dict[str, str]:
    return {"message": "Front desk API ready"}


# ==================== 客房订餐 ====================

@router.post("/rooms/{room_id}/meals")
def create_meal_order(room_id: str, payload: MealOrderRequest) -> Dict[str, Any]:
    """
    提交客房订餐订单
    """
    if not payload.items:
        raise HTTPException(status_code=400, detail="订单不能为空")
    
    total_fee = sum(item.price * item.qty for item in payload.items)
    order_id = str(uuid4())
    
    order = {
        "order_id": order_id,
        "room_id": room_id,
        "items": [{"id": i.id, "name": i.name, "price": i.price, "qty": i.qty} for i in payload.items],
        "total_fee": total_fee,
        "note": payload.note,
        "created_at": datetime.utcnow(),
    }
    
    repository.add_meal_order(order)
    
    return {
        "orderId": order_id,
        "roomId": room_id,
        "items": order["items"],
        "totalFee": total_fee,
        "note": payload.note,
        "createdAt": order["created_at"].isoformat(),
    }


@router.get("/rooms/{room_id}/meals")
def list_meal_orders(room_id: str) -> Dict[str, Any]:
    """
    获取房间的订餐记录（本次入住期间）
    """
    # 获取本次入住时间
    accommodation_order = repository.get_latest_accommodation_order(room_id)
    check_in_at = accommodation_order.get("check_in_at") if accommodation_order else None
    
    orders = list(repository.list_meal_orders(room_id, since=check_in_at))
    total_fee = sum(o["total_fee"] for o in orders)
    
    return {
        "roomId": room_id,
        "orders": [
            {
                "orderId": o["order_id"],
                "items": o["items"],
                "totalFee": o["total_fee"],
                "note": o["note"],
                "createdAt": o["created_at"].isoformat() if o["created_at"] else None,
            }
            for o in orders
        ],
        "totalFee": total_fee,
    }
