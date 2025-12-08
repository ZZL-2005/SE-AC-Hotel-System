"""监控接口：提供房间实时状态（Monitor，对应 PPT 监控界面）。"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, List, Optional

import yaml
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from app.config import CONFIG_PATH
from domain.room import Room, RoomStatus
from infrastructure.database import SessionLocal
from infrastructure.models import (
    ACDetailRecordModel,
    RoomModel,
    ServiceObjectModel,
    WaitEntryModel,
)
from interfaces import deps

router = APIRouter(prefix="/monitor", tags=["monitor"])


class OpenRoomRequest(BaseModel):
    roomId: str = Field(..., min_length=1, max_length=32)
    initialTemp: float = Field(..., description="房间初始温度")
    ratePerNight: float = Field(..., gt=0, description="房费（元/天）")


class HyperParamResponse(BaseModel):
    maxConcurrent: int
    timeSliceSeconds: int
    changeTempMs: int
    autoRestartThreshold: float
    idleDriftPerMin: float
    midDeltaPerMin: float
    highMultiplier: float
    lowMultiplier: float
    defaultTarget: float
    pricePerUnit: float
    rateHighUnitPerMin: float
    rateMidUnitPerMin: float
    rateLowUnitPerMin: float
    ratePerNight: float
    clockRatio: float


class UpdateHyperParamRequest(BaseModel):
    maxConcurrent: Optional[int] = Field(None, ge=1, le=100)
    timeSliceSeconds: Optional[int] = Field(None, ge=10, le=3600)
    changeTempMs: Optional[int] = Field(None, ge=100, le=10000)
    autoRestartThreshold: Optional[float] = Field(None, gt=0, le=10)
    idleDriftPerMin: Optional[float] = Field(None, ge=0.0, le=5.0)
    midDeltaPerMin: Optional[float] = Field(None, gt=0, le=5.0)
    highMultiplier: Optional[float] = Field(None, gt=0.5, le=5.0)
    lowMultiplier: Optional[float] = Field(None, gt=0.1, le=2.0)
    defaultTarget: Optional[float] = Field(None, ge=10, le=40)
    pricePerUnit: Optional[float] = Field(None, gt=0)
    rateHighUnitPerMin: Optional[float] = Field(None, gt=0)
    rateMidUnitPerMin: Optional[float] = Field(None, gt=0)
    rateLowUnitPerMin: Optional[float] = Field(None, gt=0)
    ratePerNight: Optional[float] = Field(None, gt=0)
    clockRatio: Optional[float] = Field(None, gt=0.01, le=200.0)


@router.post("/rooms/open")
def open_room(payload: OpenRoomRequest) -> Dict[str, Any]:
    """管理员自定义开房间，写入初始温度与房费。"""
    room = deps.repository.get_room(payload.roomId)
    if not room:
        room = Room(room_id=payload.roomId)

    deps.scheduler.cancel_request(payload.roomId)
    deps.billing_service.close_current_detail_record(payload.roomId, datetime.utcnow())

    room.status = RoomStatus.VACANT
    room.is_serving = False
    room.active_service_id = None
    room.initial_temp = payload.initialTemp
    room.current_temp = payload.initialTemp
    room.target_temp = payload.initialTemp
    room.total_fee = 0.0
    room.rate_per_night = payload.ratePerNight

    deps.repository.save_room(room)
    return {
        "roomId": room.room_id,
        "initialTemp": room.initial_temp,
        "ratePerNight": room.rate_per_night,
        "status": room.status.value,
    }


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


@router.get("/hyperparams", response_model=HyperParamResponse)
def get_hyper_params() -> HyperParamResponse:
    """Return current hyperparameter configuration for admin use."""
    return _hyperparams_from_settings()


@router.post("/hyperparams", response_model=HyperParamResponse)
def update_hyper_params(payload: UpdateHyperParamRequest) -> HyperParamResponse:
    """Update and persist hyperparameters, then refresh runtime services."""
    updates = payload.dict(exclude_none=True)
    if updates:
        raw = deepcopy(deps.settings.raw)
        _apply_hyperparam_updates(raw, updates)
        _write_config(raw)
        deps.reload_settings_from_disk()
    return _hyperparams_from_settings()


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


def _hyperparams_from_settings() -> HyperParamResponse:
    settings = deps.settings
    scheduling_cfg = settings.scheduling or {}
    throttle_cfg = settings.throttle or {}
    temp_cfg = settings.temperature or {}
    billing_cfg = settings.billing or {}
    accommodation_cfg = settings.accommodation or {}
    clock_cfg = settings.clock or {}
    return HyperParamResponse(
        maxConcurrent=int(scheduling_cfg.get("max_concurrent", 3)),
        timeSliceSeconds=int(scheduling_cfg.get("time_slice_seconds", 60)),
        changeTempMs=int(throttle_cfg.get("change_temp_ms", 1000)),
        autoRestartThreshold=float(temp_cfg.get("auto_restart_threshold", 1.0)),
        idleDriftPerMin=float(temp_cfg.get("idle_drift_per_min", 0.5)),
        midDeltaPerMin=float(temp_cfg.get("mid_delta_per_min", 0.5)),
        highMultiplier=float(temp_cfg.get("high_multiplier", 1.2)),
        lowMultiplier=float(temp_cfg.get("low_multiplier", 0.8)),
        defaultTarget=float(temp_cfg.get("default_target", 25.0)),
        pricePerUnit=float(billing_cfg.get("price_per_unit", 1.0)),
        rateHighUnitPerMin=float(billing_cfg.get("rate_high_unit_per_min", 1.0)),
        rateMidUnitPerMin=float(billing_cfg.get("rate_mid_unit_per_min", 0.5)),
        rateLowUnitPerMin=float(billing_cfg.get("rate_low_unit_per_min", 1 / 3)),
        ratePerNight=float(accommodation_cfg.get("rate_per_night", 300.0)),
        clockRatio=float(clock_cfg.get("ratio", 1.0)),
    )


def _apply_hyperparam_updates(raw: Dict[str, Any], updates: Dict[str, Any]) -> None:
    scheduling = raw.setdefault("scheduling", {})
    throttle = raw.setdefault("throttle", {})
    temperature = raw.setdefault("temperature", {})
    billing = raw.setdefault("billing", {})
    accommodation = raw.setdefault("accommodation", {})
    clock = raw.setdefault("clock", {})

    if "maxConcurrent" in updates:
        scheduling["max_concurrent"] = int(updates["maxConcurrent"])
    if "timeSliceSeconds" in updates:
        scheduling["time_slice_seconds"] = int(updates["timeSliceSeconds"])
    if "changeTempMs" in updates:
        throttle["change_temp_ms"] = int(updates["changeTempMs"])
    if "autoRestartThreshold" in updates:
        temperature["auto_restart_threshold"] = float(updates["autoRestartThreshold"])
    if "idleDriftPerMin" in updates:
        temperature["idle_drift_per_min"] = float(updates["idleDriftPerMin"])
    if "midDeltaPerMin" in updates:
        temperature["mid_delta_per_min"] = float(updates["midDeltaPerMin"])
    if "highMultiplier" in updates:
        temperature["high_multiplier"] = float(updates["highMultiplier"])
    if "lowMultiplier" in updates:
        temperature["low_multiplier"] = float(updates["lowMultiplier"])
    if "defaultTarget" in updates:
        temperature["default_target"] = float(updates["defaultTarget"])
    if "pricePerUnit" in updates:
        billing["price_per_unit"] = float(updates["pricePerUnit"])
    if "rateHighUnitPerMin" in updates:
        billing["rate_high_unit_per_min"] = float(updates["rateHighUnitPerMin"])
    if "rateMidUnitPerMin" in updates:
        billing["rate_mid_unit_per_min"] = float(updates["rateMidUnitPerMin"])
    if "rateLowUnitPerMin" in updates:
        billing["rate_low_unit_per_min"] = float(updates["rateLowUnitPerMin"])
    if "ratePerNight" in updates:
        accommodation["rate_per_night"] = float(updates["ratePerNight"])
    if "clockRatio" in updates:
        clock["ratio"] = float(updates["clockRatio"])


def _write_config(raw: Dict[str, Any]) -> None:
    CONFIG_PATH.write_text(
        yaml.safe_dump(raw, sort_keys=False, allow_unicode=False),
        encoding="utf-8",
    )

