"""Routers for front-desk workflows such as check-in/out."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from interfaces import deps

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
    """
    办理退房结账。
    """
    try:
        return checkout_service.check_out(payload.roomId)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/rooms/{room_id}/bills")
def get_room_bills(room_id: str) -> Dict[str, Any]:
    """
    获取房间账单信息。
    """
    return checkout_service.get_room_bills(room_id)


@router.get("/frontdesk/status")
def get_frontdesk_status() -> Dict[str, str]:
    return {"message": "Front desk API ready"}
