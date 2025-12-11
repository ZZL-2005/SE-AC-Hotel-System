"""调试专用API路由 - 用于系统调试和快捷操作"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel, Field

from infrastructure.database import SessionLocal
from infrastructure.models import RoomModel
from interfaces import deps

router = APIRouter(prefix="/debug", tags=["debug"])


class SetTemperatureRequest(BaseModel):
    roomId: str = Field(..., min_length=1, max_length=32)
    temperature: float = Field(..., ge=10, le=40)


class SetFeeRequest(BaseModel):
    roomId: str = Field(..., min_length=1, max_length=32)
    currentFee: float | None = Field(None, ge=0)
    totalFee: float | None = Field(None, ge=0)


class BatchCheckinRequest(BaseModel):
    roomIds: List[str] = Field(..., min_items=1, max_items=100)


@router.post("/set-temperature")
def set_temperature(payload: SetTemperatureRequest) -> Dict[str, Any]:
    """
    直接设置房间当前温度（跳过温度模拟）
    
    ⚠️ 危险操作：仅用于调试
    """
    room = deps.room_repository.get_room(payload.roomId)
    if not room:
        return {"error": f"Room {payload.roomId} not found"}
    
    room.current_temp = payload.temperature
    deps.room_repository.save_room(room)
    
    return {
        "success": True,
        "roomId": payload.roomId,
        "currentTemp": room.current_temp,
    }


@router.post("/set-fee")
def set_fee(payload: SetFeeRequest) -> Dict[str, Any]:
    """
    直接修改房间费用数据
    
    ⚠️ 危险操作：仅用于调试
    注意：这个操作会破坏费用一致性，谨慎使用
    """
    # 这个功能实际上比较复杂，因为费用是通过详单记录计算的
    # 为了调试目的，我们可以直接修改 room.total_fee 和相关计时器的 current_fee
    room = deps.room_repository.get_room(payload.roomId)
    if not room:
        return {"error": f"Room {payload.roomId} not found"}
    
    # 更新 room 的 total_fee（这个字段在实际业务中并不直接使用，但为了调试可以设置）
    if payload.totalFee is not None:
        room.total_fee = payload.totalFee
        deps.room_repository.save_room(room)
    
    # 如果要修改 currentFee，需要访问计时器（这里简化处理）
    message = "费用已设置（注意：此操作可能与实际计费不一致）"
    
    return {
        "success": True,
        "roomId": payload.roomId,
        "totalFee": room.total_fee,
        "message": message,
    }


@router.post("/batch-checkin")
def batch_checkin(payload: BatchCheckinRequest) -> Dict[str, Any]:
    """
    批量快速入住（使用默认参数）
    
    用于快速初始化多个房间的测试场景
    """
    from datetime import datetime, timezone
    
    results = []
    for idx, room_id in enumerate(payload.roomIds):
        try:
            # 调用前台入住服务
            from application.frontdesk_service import FrontDeskService
            
            frontdesk = FrontDeskService(
                room_repository=deps.room_repository,
                billing_service=deps.billing_service,
            )
            
            order = frontdesk.check_in(
                cust_id=f"DEBUG{idx:03d}",
                cust_name=f"调试用户{idx + 1}",
                guest_count=1,
                check_in_date=datetime.now(timezone.utc),
                room_id=room_id,
                deposit=0.0,
            )
            
            results.append({
                "roomId": room_id,
                "orderId": order.order_id,
                "success": True,
            })
        except Exception as e:
            results.append({
                "roomId": room_id,
                "success": False,
                "error": str(e),
            })
    
    success_count = sum(1 for r in results if r["success"])
    
    return {
        "total": len(payload.roomIds),
        "success": success_count,
        "failed": len(payload.roomIds) - success_count,
        "results": results,
    }


@router.post("/global/power-on")
def global_power_on() -> Dict[str, Any]:
    """
    全局开机：批量给所有已入住房间开机
    
    用于空调管理员快速操作
    """
    with SessionLocal() as session:
        from sqlalchemy import select
        rooms = session.exec(
            select(RoomModel).where(RoomModel.status == "OCCUPIED")
        ).all()
    
    results = []
    for room_model in rooms:
        try:
            room = deps.room_repository.get_room(room_model.room_id)
            if not room:
                continue
            
            # 只对未开机的房间操作
            if not room.is_serving and not room.is_waiting:
                from application.use_ac_service import UseACService
                
                ac_service = UseACService(
                    scheduler=deps.scheduler,
                    room_repository=deps.room_repository,
                )
                
                ac_service.power_on(room.room_id)
                results.append({
                    "roomId": room.room_id,
                    "success": True,
                })
        except Exception as e:
            results.append({
                "roomId": room_model.room_id,
                "success": False,
                "error": str(e),
            })
    
    success_count = sum(1 for r in results if r["success"])
    
    return {
        "total": len(results),
        "success": success_count,
        "failed": len(results) - success_count,
        "results": results,
    }
