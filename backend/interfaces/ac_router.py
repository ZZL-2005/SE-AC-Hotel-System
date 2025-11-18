from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from interfaces import deps
from infrastructure.database import SessionLocal
from infrastructure.models import ACDetailRecordModel, RoomModel, ServiceObjectModel, WaitEntryModel

router = APIRouter(prefix="/rooms", tags=["ac"])


class PowerOnRequest(BaseModel):
    mode: str
    targetTemp: float
    speed: str


class ChangeTempRequest(BaseModel):
    targetTemp: float


class ChangeSpeedRequest(BaseModel):
    speed: str


def _room_state(room_id: str) -> Dict[str, Any]:
    with SessionLocal() as session:
        room = session.get(RoomModel, room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        service = session.get(ServiceObjectModel, room_id)
        wait = session.get(WaitEntryModel, room_id)
        fee_row = (
            session.exec(
                select(func.coalesce(func.sum(ACDetailRecordModel.fee_value), 0.0)).where(
                    ACDetailRecordModel.room_id == room_id
                )
            ).first()
            or 0.0
        )

        return {
            "roomId": room.room_id,
            "status": "serving" if service else ("waiting" if wait else ("occupied" if room.status == "OCCUPIED" else "idle")),
            "currentTemp": room.current_temp,
            "targetTemp": room.target_temp,
            "speed": room.speed,
            "isServing": bool(service),
            "isWaiting": bool(wait),
            "currentFee": service.current_fee if service else 0.0,
            "totalFee": float(fee_row),
            "mode": room.mode,
        }


# ========== 1. Power On ==========
@router.post("/{room_id}/ac/power-on")
def power_on(room_id: str, payload: PowerOnRequest) -> Dict[str, Any]:
    deps.ac_service.power_on(room_id, payload.mode, payload.targetTemp, payload.speed)
    return _room_state(room_id)


# ========== 2. Power Off ==========
@router.post("/{room_id}/ac/power-off")
def power_off(room_id: str) -> Dict[str, Any]:
    deps.ac_service.power_off(room_id)
    return _room_state(room_id)


# ========== 3. Change Temperature ==========
@router.post("/{room_id}/ac/change-temp")
def change_temp(room_id: str, payload: ChangeTempRequest) -> Dict[str, Any]:
    deps.ac_service.change_temp(room_id, payload.targetTemp)
    return _room_state(room_id)


# ========== 4. Change Speed ==========
@router.post("/{room_id}/ac/change-speed")
def change_speed(room_id: str, payload: ChangeSpeedRequest) -> Dict[str, Any]:
    if payload.speed not in ("HIGH", "MID", "LOW"):
        raise HTTPException(status_code=400, detail="invalid speed")
    deps.ac_service.change_speed(room_id, payload.speed)
    return _room_state(room_id)


# ========== 5. Get State ==========
@router.get("/{room_id}/ac/state")
def ac_state(room_id: str) -> Dict[str, Any]:
    return _room_state(room_id)
