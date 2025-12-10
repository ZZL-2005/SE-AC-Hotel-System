"""Socket.IO 管理器 - 由 Scheduler 调用，向前端推送状态更新

架构：
    TimeManager → (内部事件) → Scheduler → (调用本模块) → 前端
"""
from __future__ import annotations

import socketio
from typing import Any, Dict, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from infrastructure.repository import RoomRepository

# 创建 AsyncServer 实例
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=["http://localhost:5173", "http://localhost:5174"],
    logger=False,
    engineio_logger=False,
)

# 房间订阅映射：sid -> room_id
_subscriptions: Dict[str, str] = {}
_room_repository: Optional["RoomRepository"] = None
_waiting_queue = None
_service_queue = None


def set_room_repository(repo: "RoomRepository") -> None:
    """设置房间仓储（用于获取完整房间状态）"""
    global _room_repository
    _room_repository = repo


def set_queues(service_queue, waiting_queue) -> None:
    """设置队列引用（用于判断房间是否在等待/服务中）"""
    global _service_queue, _waiting_queue
    _service_queue = service_queue
    _waiting_queue = waiting_queue


def get_room_repository() -> Optional["RoomRepository"]:
    """获取房间仓储"""
    return _room_repository


# ========== Socket.IO 事件处理 ==========

@sio.event
async def connect(sid: str, environ: dict) -> None:
    """客户端连接"""
    print(f"[Socket.IO] Client connected: {sid}")


@sio.event
async def disconnect(sid: str) -> None:
    """客户端断开"""
    print(f"[Socket.IO] Client disconnected: {sid}")
    # 清理订阅
    if sid in _subscriptions:
        room_id = _subscriptions.pop(sid)
        await sio.leave_room(sid, f"room:{room_id}")


@sio.event
async def subscribe_room(sid: str, data: dict) -> None:
    """客户端订阅特定房间的状态更新"""
    room_id = data.get("roomId")
    if not room_id:
        return
    
    # 离开之前的房间
    if sid in _subscriptions:
        old_room = _subscriptions[sid]
        await sio.leave_room(sid, f"room:{old_room}")
    
    # 加入新房间
    _subscriptions[sid] = room_id
    await sio.enter_room(sid, f"room:{room_id}")
    print(f"[Socket.IO] {sid} subscribed to room:{room_id}")
    
    # 立即推送当前状态
    await push_room_state(room_id)


@sio.event
async def subscribe_monitor(sid: str, data: dict = None) -> None:
    """客户端订阅监控面板的全局更新"""
    await sio.enter_room(sid, "monitor")
    print(f"[Socket.IO] {sid} subscribed to monitor")
    
    # 立即推送当前所有房间状态
    await push_all_rooms()


@sio.event
async def unsubscribe_monitor(sid: str, data: dict = None) -> None:
    """取消订阅监控面板"""
    await sio.leave_room(sid, "monitor")
    print(f"[Socket.IO] {sid} unsubscribed from monitor")


# ========== 推送函数（供 Scheduler 调用）==========

async def push_room_state(room_id: str) -> None:
    """推送单个房间状态给订阅该房间的客户端和监控面板"""
    if not _room_repository:
        return
    room = _room_repository.get_room(room_id)
    if not room:
        return
    state = _room_to_dict(room)
    # 推送给订阅该房间的客户端
    await sio.emit("room_state", state, room=f"room:{room_id}")
    # 同时推送给监控面板
    await sio.emit("room_state", state, room="monitor")


async def push_all_rooms() -> None:
    """推送所有房间状态（给监控面板）"""
    if not _room_repository:
        return
    rooms = [_room_to_dict(r) for r in _room_repository.list_rooms()]
    await sio.emit("monitor_update", {"rooms": rooms}, room="monitor")


async def push_system_event(event_type: str, room_id: str, message: str) -> None:
    """推送系统事件（给监控面板）"""
    import time
    event = {
        "id": f"{int(time.time() * 1000)}-{room_id}-{event_type}",
        "time": int(time.time() * 1000),
        "type": event_type,
        "roomId": room_id,
        "message": message,
    }
    await sio.emit("system_event", event, room="monitor")


def _room_to_dict(room) -> Dict[str, Any]:
    """将 Room 对象转换为前端需要的格式"""
    # 直接查询队列判断状态，并获取 ServiceObject
    service_entry = _service_queue.get(room.room_id) if _service_queue else None
    wait_entry = _waiting_queue.get(room.room_id) if _waiting_queue else None

    is_serving = bool(service_entry) if _service_queue else room.is_serving
    is_waiting = bool(wait_entry) if _waiting_queue else False

    # 当前段费用 & 服务/等待时长
    current_fee = 0.0
    served_seconds = 0
    waited_seconds = 0

    if service_entry is not None:
        current_fee = getattr(service_entry, "current_fee", 0.0)
        served_seconds = getattr(service_entry, "served_seconds", 0)

    if wait_entry is not None:
        waited_seconds = getattr(wait_entry, "total_waited_seconds", 0)

    # 累计费用：已完成详单 + 当前进行中的详单
    total_fee = 0.0
    if _room_repository is not None:
        # 已完成详单
        for rec in _room_repository.list_completed_detail_records(room.room_id):
            total_fee += getattr(rec, "fee_value", 0.0)
        # 当前进行中的详单
        active_rec = _room_repository.get_active_detail_record(room.room_id)
        if active_rec is not None:
            total_fee += getattr(active_rec, "fee_value", 0.0)

    return {
        "roomId": room.room_id,
        "status": room.status.value if hasattr(room.status, "value") else str(room.status),
        "currentTemp": room.current_temp,
        "targetTemp": room.target_temp,
        "speed": room.speed,
        "isServing": is_serving,
        "isWaiting": is_waiting,
        "currentFee": current_fee,
        "totalFee": total_fee,
        "servedSeconds": served_seconds,
        "waitedSeconds": waited_seconds,
        "mode": room.mode,
        "manualPowerOff": room.manual_powered_off,
        "autoRestartThreshold": getattr(room, "auto_restart_threshold", 1.0),
    }
