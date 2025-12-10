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
    mode: Optional[str] = Field(default=None, description="Override HVAC mode, defaults to config")
    targetTemp: Optional[float] = Field(default=None, description="Optional target temperature")
    speed: Optional[str] = Field(default=None, description="Optional fan speed override")


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

        # 从 TimeManager 获取实时计时数据
        served_seconds = 0
        current_fee = 0.0
        waited_seconds = 0
        
        if service and service.timer_id:
            timer_handle = deps.time_manager.get_timer_by_id(service.timer_id)
            if timer_handle and timer_handle.is_valid:
                served_seconds = timer_handle.elapsed_seconds
                current_fee = timer_handle.current_fee
            else:
                served_seconds = service.served_seconds
                current_fee = service.current_fee
        elif service:
            served_seconds = service.served_seconds
            current_fee = service.current_fee
        
        if wait and wait.timer_id:
            timer_handle = deps.time_manager.get_timer_by_id(wait.timer_id)
            if timer_handle and timer_handle.is_valid:
                waited_seconds = timer_handle.elapsed_seconds

        temp_cfg = deps.settings.temperature or {}
        return {
            "roomId": room.room_id,
            "status": "serving" if service else ("waiting" if wait else ("occupied" if room.status == "OCCUPIED" else "idle")),
            "currentTemp": room.current_temp,
            "targetTemp": room.target_temp,
            "speed": room.speed,
            "isServing": bool(service),
            "isWaiting": bool(wait),
            "currentFee": current_fee,
            "totalFee": float(fee_row),
            "servedSeconds": served_seconds,
            "waitedSeconds": waited_seconds,
            "mode": room.mode,
            "manualPowerOff": room.manual_powered_off,
            "autoRestartThreshold": float(temp_cfg.get("auto_restart_threshold", 1.0)),
        }


# ========== 1. Power On ==========
@router.post("/{room_id}/ac/power-on")
def power_on(room_id: str, payload: Optional[PowerOnRequest] = None) -> Dict[str, Any]:
    deps.ac_service.power_on(
        room_id,
        payload.mode if payload else None,
        payload.targetTemp if payload else None,
        payload.speed if payload else None,
    )
    return _room_state(room_id)


# ========== 2. Power Off ==========
@router.post("/{room_id}/ac/power-off")
def power_off(room_id: str) -> Dict[str, Any]:
    deps.ac_service.power_off(room_id)
    return _room_state(room_id)


# ========== 3. Change Temperature ==========
@router.post("/{room_id}/ac/change-temp")
def change_temp(room_id: str, payload: ChangeTempRequest) -> Dict[str, Any]:
    # 校验目标温度是否在配置的温度区间内；超出时不再报错，而是忽略本次请求并返回当前状态
    temp_cfg = deps.settings.temperature or {}
    cool_range = temp_cfg.get("cool_range") or []
    heat_range = temp_cfg.get("heat_range") or []

    with SessionLocal() as session:
        room = session.get(RoomModel, room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
        mode = (room.mode or "cool").lower()

    allowed_min = None
    allowed_max = None
    if mode == "cool" and isinstance(cool_range, (list, tuple)) and len(cool_range) == 2:
        allowed_min, allowed_max = float(cool_range[0]), float(cool_range[1])
    elif mode == "heat" and isinstance(heat_range, (list, tuple)) and len(heat_range) == 2:
        allowed_min, allowed_max = float(heat_range[0]), float(heat_range[1])

    if allowed_min is not None and not (allowed_min <= payload.targetTemp <= allowed_max):
        # 超出区间：保持目标温度不变，直接返回当前房间状态
        return _room_state(room_id)

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
