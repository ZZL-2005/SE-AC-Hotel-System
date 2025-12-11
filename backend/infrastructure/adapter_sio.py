"""SocketIO 适配器 - 为外部前端系统提供统一的 SocketIO 入口

支持 group_a 前端的 SocketIO 协议:
- 接收事件: client_action (包含多种 action: power/speed/temp/checkin/checkout/settings)
- 发送事件: sync_data, log_history, new_log
"""
from __future__ import annotations

import socketio
import httpx
from datetime import datetime
from typing import Any, Dict, List
from collections import deque

from interfaces import deps

# 创建适配用的 SocketIO 服务器
adapter_sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False,
)

# 创建 ASGI 应用
adapter_app = socketio.ASGIApp(adapter_sio)

# 内部 HTTP 基础 URL
INTERNAL_BASE_URL = "http://127.0.0.1:8000"

# 日志缓冲器 (最多保留最近 50 条)
recent_logs: deque = deque(maxlen=50)


def _add_log(log_type: str, title: str, desc: str = "") -> None:
    """添加一条日志到缓冲器并推送给所有客户端"""
    log_item = {
        "type": log_type,
        "title": title,
        "desc": desc,
        "time": datetime.now().strftime("%H:%M")
    }
    recent_logs.append(log_item)
    # 异步推送给所有连接的客户端
    import asyncio
    asyncio.create_task(adapter_sio.emit('new_log', log_item))


async def _call_internal_api(method: str, path: str, **kwargs) -> Dict[str, Any]:
    """调用内部 HTTP API"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.request(method, f"{INTERNAL_BASE_URL}{path}", **kwargs)
        response.raise_for_status()
        return response.json()


async def _get_sync_data() -> Dict[str, Any]:
    """获取完整的 sync_data 数据"""
    try:
        # 获取所有房间状态
        rooms_response = await _call_internal_api("GET", "/monitor/rooms")
        rooms_data = rooms_response.get("rooms", [])
        
        # 获取系统配置
        config_response = await _call_internal_api("GET", "/monitor/hyperparams")
        
        # 映射房间数据到 group_a 格式
        mapped_rooms = []
        for room in rooms_data:
            # 风速映射: HIGH/MID/LOW -> high/medium/low
            speed_map = {"HIGH": "high", "MID": "medium", "LOW": "low"}
            speed = speed_map.get(room.get("speed", "MID"), "medium")
            
            # 状态映射: 我们的状态 -> group_a 的 free/occupied
            our_status = room.get("status", "idle")
            status = "occupied" if our_status in ["occupied", "serving", "waiting"] else "free"
            
            mapped_room = {
                "id": room.get("roomId"),
                "status": status,
                "temp": room.get("currentTemp", 25.0),
                "initial_temp": room.get("currentTemp", 25.0),  # 简化处理
                "room_rate": 100.0,  # 默认房价
                "target": room.get("targetTemp", 25.0),
                "speed": speed,
                "currentCost": room.get("totalFee", 0.0),
                "isOn": room.get("isServing", False) or our_status == "serving",
                "isRunning": room.get("isServing", False),
                "guest": None,  # 第一版简化,不填充住户信息
                "request": None,
                "checkout_pending": False,
                "details": [],  # 第一版简化,不填充详单
                "active_log": None,
                "ac_cycles": 1,
                "last_update_time": int(datetime.now().timestamp()),
                "last_request_time": int(datetime.now().timestamp()),
            }
            mapped_rooms.append(mapped_room)
        
        # 映射系统配置到 group_a 格式
        temp_cfg = deps.settings.temperature or {}
        scheduler_cfg = deps.settings.scheduler or {}
        
        # 根据 mode 选择温度范围
        mode = temp_cfg.get("mode", "cool")
        if mode == "cool":
            temp_range = temp_cfg.get("cool_range", [18, 25])
        else:
            temp_range = temp_cfg.get("heat_range", [25, 30])
        
        config = {
            "mode": mode,
            "maxServices": scheduler_cfg.get("max_concurrent", 3),
            "baseRate": 1.0,  # 默认基础费率
            "timeSlice": scheduler_cfg.get("time_slice_seconds", 120),
            "tempLimit": {
                "min": int(temp_range[0]),
                "max": int(temp_range[1])
            }
        }
        
        # 统计信息 (第一版简化)
        stats = {
            "today_checkins": 0,
            "total_income": 0.0,
            "total_energy": 0.0
        }
        
        return {
            "rooms": mapped_rooms,
            "config": config,
            "stats": stats
        }
    except Exception as e:
        print(f"[adapter_sio] Error getting sync_data: {e}")
        return {"rooms": [], "config": {}, "stats": {}}


@adapter_sio.event
async def connect(sid: str, environ: dict) -> None:
    """客户端连接"""
    print(f"[Adapter SIO] Client connected: {sid}")
    
    # 发送历史日志
    await adapter_sio.emit('log_history', list(recent_logs), room=sid)
    
    # 发送初始 sync_data
    sync_data = await _get_sync_data()
    await adapter_sio.emit('sync_data', sync_data, room=sid)
    
    _add_log("system", "系统连接成功", "外部前端已连接")


@adapter_sio.event
async def disconnect(sid: str) -> None:
    """客户端断开"""
    print(f"[Adapter SIO] Client disconnected: {sid}")


@adapter_sio.event
async def client_action(sid: str, data: dict) -> None:
    """
    处理客户端业务指令
    
    data 格式: { roomId, action, value }
    action 可能的值:
    - update_settings: 更新系统配置
    - submit_checkin: 提交入住申请
    - approve_checkin: 批准入住
    - request_checkout: 请求结账
    - confirm_checkout: 确认结账
    - power: 空调开关
    - speed: 调整风速
    - temp: 调整目标温度
    """
    room_id = data.get("roomId")
    action = data.get("action")
    value = data.get("value")
    
    try:
        if action == "power":
            # 空调开关: value = true/false
            if value:
                await _call_internal_api("POST", f"/rooms/{room_id}/ac/power-on", json={})
                _add_log("request", f"{room_id} 空调开机", "住户操作")
            else:
                await _call_internal_api("POST", f"/rooms/{room_id}/ac/power-off")
                _add_log("request", f"{room_id} 空调关机", "住户操作")
        
        elif action == "speed":
            # 调整风速: value = "low"/"medium"/"high"
            speed_map = {"low": "LOW", "medium": "MID", "high": "HIGH"}
            our_speed = speed_map.get(value, "MID")
            await _call_internal_api("POST", f"/rooms/{room_id}/ac/change-speed", json={"speed": our_speed})
            _add_log("request", f"{room_id} 调整风速", f"风速: {value}")
        
        elif action == "temp":
            # 调整目标温度: value = 18-25
            await _call_internal_api("POST", f"/rooms/{room_id}/ac/change-temp", json={"targetTemp": float(value)})
            _add_log("request", f"{room_id} 调整温度", f"目标温度: {value}°C")
        
        elif action == "submit_checkin":
            # 提交入住申请: value = { name, idCard }
            guest_name = value.get("name", "未知")
            id_card = value.get("idCard", "")
            check_in_date = datetime.now().strftime("%Y-%m-%d")
            
            await _call_internal_api("POST", "/checkin", json={
                "roomId": room_id,
                "custId": id_card,
                "custName": guest_name,
                "guestCount": 1,
                "checkInDate": check_in_date,
                "deposit": 0.0
            })
            _add_log("checkin", f"{room_id} 入住申请", f"住户: {guest_name}")
        
        elif action == "approve_checkin":
            # 批准入住: value = true (简化处理,认为已经在 submit_checkin 完成)
            _add_log("checkin", f"{room_id} 办理入住成功", "前台批准")
        
        elif action == "request_checkout":
            # 请求结账: value = true (标记,实际结账在 confirm_checkout)
            _add_log("checkout", f"{room_id} 发起结账请求", "住户操作")
        
        elif action == "confirm_checkout":
            # 确认结账: value = true
            await _call_internal_api("POST", "/checkout", json={"roomId": room_id})
            _add_log("checkout", f"{room_id} 结账完成", "前台确认")
        
        elif action == "update_settings":
            # 更新系统配置: value = { mode, maxServices, baseRate, timeSlice }
            mode = value.get("mode", "cool")
            max_services = value.get("maxServices", 3)
            time_slice = value.get("timeSlice", 120)
            
            # 构造我们的 hyperparam 格式
            hyperparam_updates = {
                "maxConcurrent": max_services,
                "timeSliceSeconds": time_slice,
            }
            
            # 根据 mode 设置温度范围
            if "tempLimit" in value:
                temp_limit = value["tempLimit"]
                if mode == "cool":
                    hyperparam_updates["coolRangeMin"] = float(temp_limit.get("min", 18))
                    hyperparam_updates["coolRangeMax"] = float(temp_limit.get("max", 25))
                else:
                    hyperparam_updates["heatRangeMin"] = float(temp_limit.get("min", 25))
                    hyperparam_updates["heatRangeMax"] = float(temp_limit.get("max", 30))
            
            await _call_internal_api("PUT", "/monitor/hyperparams", json=hyperparam_updates)
            _add_log("system", "系统配置已更新", f"模式: {mode}, 最大并发: {max_services}")
        
        else:
            # 未知 action
            print(f"[Adapter SIO] Unknown action: {action}")
            return
        
        # 操作成功后,推送最新的 sync_data
        sync_data = await _get_sync_data()
        await adapter_sio.emit('sync_data', sync_data)
        
    except httpx.HTTPStatusError as e:
        # HTTP 错误
        error_msg = f"操作失败: {e.response.status_code}"
        if e.response.status_code == 400:
            try:
                error_detail = e.response.json().get("detail", "")
                error_msg = f"操作失败: {error_detail}"
            except:
                pass
        _add_log("system", f"{room_id} {action} 失败", error_msg)
        print(f"[Adapter SIO] HTTP error: {e}")
    
    except Exception as e:
        # 其他错误
        _add_log("system", f"{room_id} {action} 失败", str(e))
        print(f"[Adapter SIO] Error handling client_action: {e}")


# 初始化时添加一条系统日志
_add_log("system", "适配器服务已启动", "等待外部前端连接")
