"""报表接口：提供收入与用量统计（Report，对应 PPT 报表功能）。"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func
from sqlmodel import select

from infrastructure.database import SessionLocal
from infrastructure.models import (
    ACBillModel,
    ACDetailRecordModel,
    AccommodationBillModel,
)

router = APIRouter(prefix="/report", tags=["report"])


@router.get("")
def get_report(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
) -> Dict[str, Any]:
    """# 报表统计逻辑（Report）/# PPT 对应功能：经理报表。"""
    try:
        start = datetime.fromisoformat(from_)
        end = datetime.fromisoformat(to)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid time range") from exc

    with SessionLocal() as session:
        room_income = _sum_accommodation_income(session, start, end)
        ac_income = _sum_ac_income(session, start, end)
        detail_rows = _detail_rows(session, start, end)

    detail_stats = _derive_detail_stats(detail_rows)
    total_income = room_income + ac_income

    return {
        "summary": {
            "totalRevenue": total_income,
            "acRevenue": ac_income,
            "roomRevenue": room_income,
            "totalKwh": detail_stats["total_kwh"],
        },
        "trend": detail_stats["trend"],
        "speedRate": detail_stats["speed_rate"],
        "rooms": detail_stats["rooms"],
        "hourlySpeed": detail_stats["hourly_speed"],
        "kpi": detail_stats["kpi"],
    }


def _sum_accommodation_income(session, start: datetime, end: datetime) -> float:
    stmt = (
        select(func.coalesce(func.sum(AccommodationBillModel.total_fee), 0.0))
        .where(AccommodationBillModel.created_at >= start)
        .where(AccommodationBillModel.created_at <= end)
    )
    return session.exec(stmt).one()


def _sum_ac_income(session, start: datetime, end: datetime) -> float:
    stmt = (
        select(func.coalesce(func.sum(ACBillModel.total_fee), 0.0))
        .where(ACBillModel.period_start >= start)
        .where(ACBillModel.period_start <= end)
    )
    return session.exec(stmt).one()


def _detail_rows(session, start: datetime, end: datetime) -> List[ACDetailRecordModel]:
    stmt = (
        select(ACDetailRecordModel)
        .where(ACDetailRecordModel.started_at >= start)
        .where(ACDetailRecordModel.ended_at <= end)
        .where(ACDetailRecordModel.ended_at.is_not(None))
    )
    return session.exec(stmt).all()


def _derive_detail_stats(rows: List[ACDetailRecordModel]) -> Dict[str, Any]:
    trend_map: Dict[str, Dict[str, float]] = defaultdict(lambda: {"fee": 0.0, "kwh": 0.0})
    hourly_speed_map: Dict[str, Dict[str, float]] = defaultdict(lambda: {"HIGH": 0.0, "MID": 0.0, "LOW": 0.0})
    room_map: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "fee": 0.0,
            "minutes": 0.0,
            "kwh": 0.0,
            "counts": {"HIGH": 0, "MID": 0, "LOW": 0},
        }
    )
    speed_duration = {"HIGH": 0.0, "MID": 0.0, "LOW": 0.0}
    total_fee = 0.0
    total_kwh = 0.0
    total_minutes = 0.0
    detail_count = 0

    for row in rows:
        if not row.ended_at:
            continue
        duration_minutes = max((row.ended_at - row.started_at).total_seconds() / 60.0, 0.0)
        fee_value = float(row.fee_value or 0.0)
        kwh = float(row.rate_per_min or 0.0) * duration_minutes
        speed = (row.speed or "MID").upper()

        total_fee += fee_value
        total_kwh += kwh
        total_minutes += duration_minutes
        detail_count += 1

        speed_duration.setdefault(speed, 0.0)
        speed_duration[speed] += duration_minutes

        hour_key = row.started_at.strftime("%Y-%m-%d %H:00")
        trend_map[hour_key]["fee"] += fee_value
        trend_map[hour_key]["kwh"] += kwh
        hourly_speed_map[hour_key][speed] += duration_minutes

        room_stats = room_map[row.room_id]
        room_stats["fee"] += fee_value
        room_stats["minutes"] += duration_minutes
        room_stats["kwh"] += kwh
        room_stats["counts"][speed] = room_stats["counts"].get(speed, 0) + 1

    rooms: List[Dict[str, Any]] = []
    for room_id, stats in room_map.items():
        rooms.append(
            {
                "roomId": room_id,
                "minutes": round(stats["minutes"], 2),
                "highCount": stats["counts"].get("HIGH", 0),
                "midCount": stats["counts"].get("MID", 0),
                "lowCount": stats["counts"].get("LOW", 0),
                "kwh": round(stats["kwh"], 3),
                "fee": round(stats["fee"], 2),
            }
        )
    rooms.sort(key=lambda item: item["fee"], reverse=True)

    trend = [
        {"time": key, "fee": round(value["fee"], 2), "kwh": round(value["kwh"], 3)}
        for key, value in sorted(trend_map.items())
    ]

    hourly_speed = [
        {
            "hour": key,
            "high": round(value.get("HIGH", 0.0), 2),
            "mid": round(value.get("MID", 0.0), 2),
            "low": round(value.get("LOW", 0.0), 2),
        }
        for key, value in sorted(hourly_speed_map.items())
    ]

    total_duration = sum(speed_duration.values()) or 1.0
    speed_rate = {
        "high": round(speed_duration.get("HIGH", 0.0) / total_duration, 4),
        "mid": round(speed_duration.get("MID", 0.0) / total_duration, 4),
        "low": round(speed_duration.get("LOW", 0.0) / total_duration, 4),
    }

    room_count = len(room_map) or 1
    avg_kwh = total_kwh / room_count if room_map else 0.0
    avg_fee = total_fee / room_count if room_map else 0.0
    peak_hour = max(trend, key=lambda item: item["fee"]) if trend else None
    avg_session = (total_minutes / detail_count) if detail_count else 0.0

    kpi = {
        "avgKwh": round(avg_kwh, 3),
        "avgFee": round(avg_fee, 2),
        "peakHour": peak_hour["time"] if peak_hour else None,
        "highRate": speed_rate["high"],
        "avgSession": round(avg_session, 2),
    }

    return {
        "total_kwh": round(total_kwh, 3),
        "trend": trend,
        "speed_rate": speed_rate,
        "rooms": rooms,
        "hourly_speed": hourly_speed,
        "kpi": kpi,
    }

