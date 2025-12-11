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
    AccommodationOrderModel,
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


class TickIntervalRequest(BaseModel):
    interval: float = Field(..., gt=0.001, le=10.0, description="Tick 间隔（秒），0.1 = 10x 加速")


class TickIntervalResponse(BaseModel):
    interval: float = Field(..., description="当前 tick 间隔（秒）")
    speedMultiplier: float = Field(..., description="相对正常速度的倍率（1.0 / interval）")


class TimerStatsResponse(BaseModel):
    totalTimers: int
    byType: Dict[str, int]
    tickInterval: float
    tickCounter: int
    pendingEvents: int


class TickSyncResponse(BaseModel):
    success: bool
    tickCounter: int
    message: str


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
        fee_map = _detail_fee_map_since_checkin(session)

    service_map = {model.room_id: model for model in service_models}
    wait_map = {model.room_id: model for model in wait_models}

    results: List[Dict[str, Any]] = []
    for room in rooms:
        service = service_map.get(room.room_id)
        wait = wait_map.get(room.room_id)
        
        # 从 TimeManager 获取实时计时数据
        served_seconds = 0
        current_fee = 0.0
        waited_seconds = 0
        wait_remaining = 0
        
        if service and service.timer_id:
            timer_handle = deps.time_manager.get_timer_by_id(service.timer_id)
            if timer_handle and timer_handle.is_valid:
                served_seconds = timer_handle.elapsed_seconds
                current_fee = timer_handle.current_fee
            else:
                # 回退到数据库数据
                served_seconds = service.served_seconds
                current_fee = service.current_fee
        elif service:
            served_seconds = service.served_seconds
            current_fee = service.current_fee
        
        if wait and wait.timer_id:
            timer_handle = deps.time_manager.get_timer_by_id(wait.timer_id)
            if timer_handle and timer_handle.is_valid:
                waited_seconds = timer_handle.elapsed_seconds
                wait_remaining = timer_handle.remaining_seconds
            else:
                waited_seconds = wait.total_waited_seconds
                wait_remaining = wait.wait_seconds
        elif wait:
            waited_seconds = wait.total_waited_seconds
            wait_remaining = wait.wait_seconds
        
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
                "servedSeconds": served_seconds,
                "waitedSeconds": waited_seconds,
                "waitRemaining": wait_remaining,
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


# ================== Tick Interval API（时间加速控制）==================
@router.get("/tick-interval", response_model=TickIntervalResponse)
def get_tick_interval() -> TickIntervalResponse:
    """
    获取当前 tick 间隔。
    
    - interval: 实际调用间隔（秒）
    - speedMultiplier: 相对正常速度的倍率
    
    示例：
    - interval=1.0 → speedMultiplier=1.0（正常速度）
    - interval=0.1 → speedMultiplier=10.0（10倍加速）
    """
    interval = deps.time_manager.get_tick_interval()
    return TickIntervalResponse(
        interval=interval,
        speedMultiplier=1.0 / interval if interval > 0 else 1.0
    )


@router.put("/tick-interval", response_model=TickIntervalResponse)
def set_tick_interval(payload: TickIntervalRequest) -> TickIntervalResponse:
    """
    设置 tick 间隔（用于时间加速）。
    
    - interval=1.0 → 正常速度（每秒推进 1 秒逻辑时间）
    - interval=0.1 → 10x 加速（每 0.1 秒推进 1 秒逻辑时间）
    - interval=0.01 → 100x 加速
    
    注意：过低的间隔可能导致 CPU 占用过高。
    """
    deps.time_manager.set_tick_interval(payload.interval)
    interval = deps.time_manager.get_tick_interval()
    return TickIntervalResponse(
        interval=interval,
        speedMultiplier=1.0 / interval if interval > 0 else 1.0
    )


@router.get("/timer-stats", response_model=TimerStatsResponse)
def get_timer_stats() -> TimerStatsResponse:
    """获取 TimeManager 计时器统计信息（调试用）。"""
    stats = deps.time_manager.get_timer_stats()
    return TimerStatsResponse(
        totalTimers=stats["total_timers"],
        byType=stats["by_type"],
        tickInterval=stats["tick_interval"],
        tickCounter=stats["tick_counter"],
        pendingEvents=stats["pending_events"]
    )


@router.get("/timers")
def list_timers() -> Dict[str, List[Dict[str, Any]]]:
    """列出所有活跃的计时器（调试用）。"""
    return {"timers": deps.time_manager.list_timers()}


# ================== 时钟同步 API ==================
@router.get("/tick-counter")
def get_tick_counter() -> Dict[str, Any]:
    """
    获取当前 tick 计数器
    
    用于时钟同步，外部可以通过该计数器判断时钟是否推进
    """
    return {
        "tickCounter": deps.time_manager.get_tick_counter(),
        "tickInterval": deps.time_manager.get_tick_interval()
    }


@router.post("/wait-tick", response_model=TickSyncResponse)
async def wait_for_tick(
    count: int = 1,
    timeout: float = 5.0
) -> TickSyncResponse:
    """
    等待指定数量的 tick 完成（时钟同步接口）
    
    参数：
    - count: 要等待的 tick 数量（默认 1）
    - timeout: 总超时时间（秒，默认 5）
    
    返回：
    - success: 是否成功等待
    - tickCounter: 当前 tick 计数
    - message: 结果消息
    
    用法示例：
    ```python
    # 发送操作
    POST /rooms/1/ac/power-on
    # 等待 1 个 tick 完成
    POST /monitor/wait-tick?count=1
    # 读取快照
    GET /monitor/rooms
    ```
    """
    if count <= 0:
        return TickSyncResponse(
            success=False,
            tickCounter=deps.time_manager.get_tick_counter(),
            message="count must be positive"
        )
    
    if count == 1:
        success = await deps.time_manager.wait_for_next_tick(timeout=timeout)
    else:
        success = await deps.time_manager.wait_for_ticks(count=count, timeout=timeout)
    
    return TickSyncResponse(
        success=success,
        tickCounter=deps.time_manager.get_tick_counter(),
        message=f"Waited for {count} tick(s)" if success else "Timeout waiting for tick"
    )


def _derive_status(room: RoomModel, service, wait) -> str:
    if service:
        return "serving"
    if wait:
        return "waiting"
    if room.status == "OCCUPIED":
        return "occupied"
    return "idle"


def _detail_fee_map_since_checkin(session) -> Dict[str, float]:
    """Sum AC detail fees since the latest accommodation check-in per room.

    If a room has no accommodation order, fall back to sum of all records (rare).
    """
    # Fetch latest check-in time per room
    order_rows = session.exec(
        select(
            AccommodationOrderModel.room_id,
            func.max(AccommodationOrderModel.check_in_at)
        ).group_by(AccommodationOrderModel.room_id)
    ).all()
    latest_checkin_map: Dict[str, datetime] = {room_id: check_in_at for room_id, check_in_at in order_rows if check_in_at}

    fee_map: Dict[str, float] = {}
    # Rooms that have accommodation: sum fee_value where started_at >= check_in_at
    for room_id, check_in_at in latest_checkin_map.items():
        rows = session.exec(
            select(func.coalesce(func.sum(ACDetailRecordModel.fee_value), 0.0)).where(
                ACDetailRecordModel.room_id == room_id,
                ACDetailRecordModel.started_at >= check_in_at,
            )
        ).all()
        fee_map[room_id] = float(rows[0] if rows else 0.0)

    # For rooms without accommodation orders, sum all records to avoid zeroing unexpectedly
    rooms_without_order = session.exec(select(RoomModel.room_id)).all()
    for rid in rooms_without_order:
        if rid in fee_map:
            continue
        rows = session.exec(
            select(func.coalesce(func.sum(ACDetailRecordModel.fee_value), 0.0)).where(
                ACDetailRecordModel.room_id == rid
            )
        ).all()
        fee_map[rid] = float(rows[0] if rows else 0.0)

    return fee_map


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
    if "coolRangeMin" in updates and "coolRangeMax" in updates:
        temperature["cool_range"] = [float(updates["coolRangeMin"]), float(updates["coolRangeMax"])]
    if "heatRangeMin" in updates and "heatRangeMax" in updates:
        temperature["heat_range"] = [float(updates["heatRangeMin"]), float(updates["heatRangeMax"])]
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

