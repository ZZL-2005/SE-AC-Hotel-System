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
    room = deps.repository.get_room(payload.roomId)
    if not room:
        return {"error": f"Room {payload.roomId} not found"}
    
    room.current_temp = payload.temperature
    deps.repository.save_room(room)
    
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


@router.post("/system/pause")
def pause_system() -> Dict[str, Any]:
    """
    暂停系统（阻塞 tick 循环）
    
    ⚠️ 调试功能：暂停后会完全阻塞 tick 循环，系统进入冻结状态：
    - tick 计数停止递增
    - 计时器停止累加
    - 费用停止计算
    - 温度停止变化
    - 调度事件停止触发
    
    用于调试时完全冻结系统状态
    """
    deps.time_manager.pause_system()
    
    return {
        "success": True,
        "paused": True,
        "tick": deps.time_manager.get_tick_counter(),
        "message": "系统已暂停，tick 循环已阻塞"
    }


@router.post("/system/resume")
def resume_system() -> Dict[str, Any]:
    """
    恢复系统（释放 tick 阻塞）
    
    释放 tick 阻塞，系统从暂停点断点继续：
    - tick 循环恢复运行
    - 计时器继续累加
    - 费用继续计算
    - 温度继续变化
    - 调度事件继续触发
    """
    deps.time_manager.resume_system()
    
    return {
        "success": True,
        "paused": False,
        "tick": deps.time_manager.get_tick_counter(),
        "message": "系统已恢复，tick 循环继续运行"
    }


@router.get("/system/status")
def system_status() -> Dict[str, Any]:
    """
    获取系统状态
    
    返回系统是否暂停、当前 tick 计数等信息
    """
    return {
        "paused": deps.time_manager.is_paused(),
        "tick": deps.time_manager.get_tick_counter(),
        "tickInterval": deps.time_manager.get_tick_interval(),
        "timerStats": deps.time_manager.get_timer_stats(),
    }


@router.get("/timers/details")
def get_timer_details() -> Dict[str, Any]:
    """
    获取详细的计时器信息
    
    返回所有活动计时器的详细信息，包括服务计时器和等待计时器
    """
    timer_details = deps.time_manager.get_all_timer_details()
    return {
        "timers": timer_details
    }
