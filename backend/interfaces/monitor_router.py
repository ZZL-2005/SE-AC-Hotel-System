"""监控接口：提供房间实时状态（Monitor，对应 PPT 监控界面）。"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter
from sqlalchemy import func
from sqlmodel import select

from infrastructure.database import SessionLocal
from infrastructure.models import (
    ACDetailRecordModel,
    RoomModel,
    ServiceObjectModel,
    WaitEntryModel,
)

router = APIRouter(prefix="/monitor", tags=["monitor"])


@router.get("/rooms")
def list_room_status() -> Dict[str, List[Dict[str, Any]]]:
    """# 监控逻辑（Monitor）/# PPT 对应功能：返回所有房间实时状态。"""
    with SessionLocal() as session:
        rooms = session.exec(select(RoomModel)).all()
        service_models = session.exec(select(ServiceObjectModel)).all()
        wait_models = session.exec(select(WaitEntryModel)).all()
        fee_map = _detail_fee_map(session)

    service_map = {model.room_id: model for model in service_models}
    wait_map = {model.room_id: model for model in wait_models}

    results: List[Dict[str, Any]] = []
    for room in rooms:
        service = service_map.get(room.room_id)
        wait = wait_map.get(room.room_id)
        current_fee = service.current_fee if service else 0.0
        total_fee = fee_map.get(room.room_id, 0.0)
        status = _derive_status(room, service, wait)
        results.append(
            {
                "roomId": room.room_id,
                "status": status,
                "currentTemp": room.current_temp,
                "targetTemp": room.target_temp,
                "speed": room.speed,
                "isServing": bool(service),
                "isWaiting": bool(wait),
                "currentFee": current_fee,
                "totalFee": total_fee,
                "servedSeconds": service.served_seconds if service else 0,
                "waitedSeconds": wait.total_waited_seconds if wait else 0,
                "serviceSpeed": service.speed if service else None,
                "serviceStartedAt": service.started_at.isoformat() if service and service.started_at else None,
                "waitSpeed": wait.speed if wait else None,
            }
        )
    return {"rooms": results}


def _derive_status(room: RoomModel, service, wait) -> str:
    if service:
        return "serving"
    if wait:
        return "waiting"
    if room.status == "OCCUPIED":
        return "occupied"
    return "idle"


def _detail_fee_map(session) -> Dict[str, float]:
    stmt = select(ACDetailRecordModel.room_id, func.coalesce(func.sum(ACDetailRecordModel.fee_value), 0.0)).group_by(
        ACDetailRecordModel.room_id
    )
    rows = session.exec(stmt).all()
    return {room_id: fee for room_id, fee in rows}

