"""适配器路由 - 为外部前端系统提供统一的HTTP入口

支持 group_a 前端的接口:
- GET /adapter/export/bill/{room_id} - 导出房间综合账单(文本格式)
- GET /adapter/export/detail/{room_id} - 导出房间空调详单(CSV格式)
"""
from __future__ import annotations

import httpx
from datetime import datetime
from typing import Any, Dict
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import PlainTextResponse

from interfaces import deps

router = APIRouter(prefix="/adapter", tags=["adapter"])

# 内部 HTTP 基础 URL (本地回环)
INTERNAL_BASE_URL = "http://127.0.0.1:8000"
# NOTE: Prefer logical time fields when available.


def _format_logic_time(seconds: Any) -> str:
    try:
        total = int(seconds)
    except (TypeError, ValueError):
        return ""
    if total < 0:
        total = 0
    return f"T+{total // 60:02d}:{total % 60:02d}"


async def _call_internal_api(method: str, path: str, **kwargs) -> Dict[str, Any]:
    """调用内部 HTTP API 的统一封装"""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.request(method, f"{INTERNAL_BASE_URL}{path}", **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise HTTPException(status_code=404, detail="无数据")
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"内部接口调用失败: {e.response.text}"
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"适配器错误: {str(e)}")


@router.get("/export/bill/{room_id}")
async def export_bill(room_id: str) -> Response:
    """
    导出房间综合账单(文本格式)
    
    对应 group_a 接口: GET /export/bill/{room_id}
    返回格式: text/plain
    """
    # 调用内部接口获取账单数据
    bills_data = await _call_internal_api("GET", f"/rooms/{room_id}/bills")
    
    # 提取数据
    accommodation_bill = bills_data.get("accommodationBill")
    ac_bill = bills_data.get("acBill")
    meal_bill = bills_data.get("mealBill")
    
    # 检查是否有有效的账单数据
    if not accommodation_bill and not ac_bill:
        raise HTTPException(status_code=404, detail=f"房间 {room_id} 暂无账单数据")
    
    # 获取住户信息 (从入住订单获取)
    guest_name = accommodation_bill.get("guestName", "未知") if accommodation_bill else "未知"
    check_in_time = accommodation_bill.get("checkInTime", "未知") if accommodation_bill else "未知"
    
    # 费用信息
    ac_fee = ac_bill.get("totalFee", 0.0) if ac_bill else 0.0
    room_fee = accommodation_bill.get("roomFee", 0.0) if accommodation_bill else 0.0
    nights = accommodation_bill.get("nights", 1) if accommodation_bill else 1
    rate_per_night = accommodation_bill.get("ratePerNight", 0.0) if accommodation_bill else 0.0
    meal_fee = meal_bill.get("totalFee", 0.0) if meal_bill else 0.0
    total_due = bills_data.get("totalDue", ac_fee + room_fee + meal_fee)
    
    # 当前时间
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 格式化入住时间
    if isinstance(check_in_time, str) and check_in_time != "未知":
        try:
            check_in_dt = datetime.fromisoformat(check_in_time.replace('Z', '+00:00'))
            check_in_str = check_in_dt.strftime("%Y-%m-%d %H:%M:%S")
        except:
            check_in_str = check_in_time
    else:
        check_in_str = "未知"
    
    # 组装文本账单
    bill_text = f"""=== 波普特酒店 - 结账单 ===
打印时间: {current_time}
------------------------------
房间号  : {room_id}
住户姓名: {guest_name}
入住时间: {check_in_str}
------------------------------
空调费用: {ac_fee:.2f} 元
住宿费用: {room_fee:.2f} 元 ({rate_per_night:.1f}元/天 x {nights})
餐饮费用: {meal_fee:.2f} 元
------------------------------
总计应收: {total_due:.2f} 元"""
    
    return PlainTextResponse(content=bill_text, media_type="text/plain; charset=utf-8")


@router.get("/export/detail/{room_id}")
async def export_detail(room_id: str) -> Response:
    """
    导出房间空调详单(CSV格式)
    
    对应 group_a 接口: GET /export/detail/{room_id}
    返回格式: text/csv
    """
    # 调用内部接口获取详单数据
    bills_data = await _call_internal_api("GET", f"/rooms/{room_id}/bills")
    
    if not bills_data:
        raise HTTPException(status_code=404, detail="无数据")
    
    detail_records = bills_data.get("detailRecords", [])
    
    # CSV 表头
    csv_lines = ["房间号,请求时间,服务开始时间,服务结束时间,服务时长(秒),风速,本段费用(元),累积费用(元)"]
    
    # 累计费用计数器
    cumulative_fee = 0.0
    
    for record in detail_records:
        # 提取字段
        started_at = record.get("startedAt", "")
        ended_at = record.get("endedAt", "")
        logic_start = record.get("logicStartSeconds")
        logic_end = record.get("logicEndSeconds")
        duration = record.get("durationSeconds")
        speed = record.get("speed", "MID")
        fee_value = record.get("feeValue", 0.0)
        
        # 格式化时间（优先使用逻辑时间，缺失时回退到墙钟时间）
        start_dt = None
        start_str = _format_logic_time(logic_start) if logic_start is not None else ""
        end_str = _format_logic_time(logic_end) if logic_end is not None else ""

        if not start_str:
            try:
                start_dt = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
                start_str = start_dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                start_str = str(started_at)

        if not end_str:
            try:
                if ended_at:
                    end_dt = datetime.fromisoformat(str(ended_at).replace("Z", "+00:00"))
                    end_str = end_dt.strftime("%Y-%m-%d %H:%M:%S")
                else:
                    end_str = "运行中"
            except Exception:
                end_str = str(ended_at) if ended_at else "运行中"

        # Prefer backend-provided logical duration, then derive from logic timestamps.
        if duration is None and logic_start is not None and logic_end is not None:
            try:
                duration = max(0, int(logic_end) - int(logic_start))
            except (TypeError, ValueError):
                duration = None
        if duration is None:
            try:
                if start_dt and ended_at:
                    end_dt = datetime.fromisoformat(str(ended_at).replace("Z", "+00:00"))
                    duration = max(0, int((end_dt - start_dt).total_seconds()))
                else:
                    duration = 0
            except Exception:
                duration = 0
        
        # 风速映射: HIGH/MID/LOW -> high/medium/low
        speed_map = {"HIGH": "high", "MID": "medium", "LOW": "low"}
        speed_lower = speed_map.get(speed, speed.lower())
        
        # 累计费用
        cumulative_fee += fee_value
        
        # 请求时间暂时用服务开始时间(因为我们现有模型没有单独的请求时间字段)
        request_time = start_str
        
        # 组装 CSV 行
        csv_lines.append(
            f"{room_id},{request_time},{start_str},{end_str},{duration},{speed_lower},{fee_value:.2f},{cumulative_fee:.2f}"
        )
    
    csv_text = "\n".join(csv_lines)
    
    return PlainTextResponse(content=csv_text, media_type="text/csv; charset=utf-8")
