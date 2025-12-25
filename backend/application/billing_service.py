"""Billing service covering PPT 计费规则 & 详单分段逻辑."""
from __future__ import annotations

from datetime import datetime
from typing import Dict, Optional, TYPE_CHECKING
from uuid import uuid4

from app.config import AppConfig
from domain.bill import ACBill
from domain.detail_record import ACDetailRecord
from infrastructure.repository import RoomRepository

if TYPE_CHECKING:
    from application.time_manager import TimeManager
    from application.timer_handle import TimerHandle


class BillingService:
    def __init__(
        self, 
        config: AppConfig, 
        repository: RoomRepository,
        time_manager: Optional["TimeManager"] = None
    ):
        self.config = config
        self.repository = repository
        self.time_manager = time_manager
        self._apply_billing_config()
        self.current_records: Dict[str, ACDetailRecord] = {}
        self._detail_timers: Dict[str, "TimerHandle"] = {}  # room_id -> TimerHandle

    def set_time_manager(self, time_manager: "TimeManager") -> None:
        """设置时间管理器（后置注入，避免循环依赖）"""
        self.time_manager = time_manager

    def _apply_billing_config(self) -> None:
        billing_cfg = self.config.billing or {}
        self.price_per_unit = float(billing_cfg.get("price_per_unit", 1.0))
        self.rate_map = {
            "HIGH": float(billing_cfg.get("rate_high_unit_per_min", 1.0)),
            "MID": float(billing_cfg.get("rate_mid_unit_per_min", 0.5)),
            "LOW": float(billing_cfg.get("rate_low_unit_per_min", 1 / 3)),
        }

    def update_config(self, config: AppConfig) -> None:
        self.config = config
        self._apply_billing_config()

    # 详单分段逻辑 --------------------------------------------------------
    def start_new_detail_record(self, room_id: str, speed: str, timestamp: datetime) -> None:
        """详单分段逻辑: 新会话/风速变化开新段."""
        self.close_current_detail_record(room_id, timestamp)
        rate = self._rate_for_speed(speed)
        logic_start_seconds = self._accommodation_elapsed_seconds(room_id)
        
        # 创建详单计时器（如果 TimeManager 可用）
        timer_id = None
        if self.time_manager:
            timer_handle = self.time_manager.create_detail_timer(room_id, speed)
            self._detail_timers[room_id] = timer_handle
            timer_id = timer_handle.timer_id
        
        record = ACDetailRecord(
            record_id=str(uuid4()),
            room_id=room_id,
            speed=speed,
            started_at=timestamp,
            rate_per_min=rate,
            fee_value=0.0,
            logic_start_seconds=logic_start_seconds,
            timer_id=timer_id,
        )
        self.current_records[room_id] = record
        self.repository.add_detail_record(record)

    def close_current_detail_record(self, room_id: str, timestamp: datetime) -> None:
        """详单分段逻辑: 服务停止或改变风速时结束片段."""
        record = self.current_records.get(room_id) or self.repository.get_active_detail_record(room_id)
        if not record or record.ended_at:
            return
        
        # 从计时器获取实际累计费用（如果有）
        timer_handle = self._detail_timers.pop(room_id, None)
        detail_elapsed_seconds: Optional[int] = None
        if timer_handle and timer_handle.is_valid:
            detail_elapsed_seconds = timer_handle.elapsed_seconds
            record.fee_value = timer_handle.current_fee
            timer_handle.cancel()

        record.logic_end_seconds = self._accommodation_elapsed_seconds(room_id)
        if (
            record.logic_start_seconds is None
            and record.logic_end_seconds is not None
            and detail_elapsed_seconds is not None
        ):
            record.logic_start_seconds = max(0, record.logic_end_seconds - detail_elapsed_seconds)
        
        record.ended_at = timestamp
        self.repository.update_detail_record(record)
        self.current_records.pop(room_id, None)

    # PPT 计费规则 --------------------------------------------------------
    def tick_fee(self, room_id: str, speed: str) -> float:
        """
        每秒调用一次，累加费用。
        
        此方法由 TimeManager 作为回调调用。
        """
        record = self.current_records.get(room_id)
        if not record:
            record = self.repository.get_active_detail_record(room_id)
            if not record:
                return 0.0
            self.current_records[room_id] = record
        fee_increment = (record.rate_per_min / 60.0) * self.price_per_unit
        record.fee_value += fee_increment
        self.repository.update_detail_record(record)
        return fee_increment

    def aggregate_records_to_bill(self, room_id: str) -> Optional[ACBill]:
        """Create ACBill from 历史详单."""
        completed = list(self.repository.list_completed_detail_records(room_id))
        if not completed:
            return None

        # 只汇总本次入住后的详单，避免多次入住累加历史记录导致账单/详单不一致
        order = self.repository.get_latest_accommodation_order(room_id)
        check_in_at = order.get("check_in_at") if order else None
        if check_in_at:
            completed = [rec for rec in completed if rec.started_at >= check_in_at]
            if not completed:
                return None

        period_start = min(rec.started_at for rec in completed)
        period_end = max(rec.ended_at for rec in completed if rec.ended_at)
        bill = ACBill(
            bill_id=str(uuid4()),
            room_id=room_id,
            period_start=period_start,
            period_end=period_end,
            total_fee=0.0,
            details=[],
        )
        for rec in completed:
            bill.add_record(rec)
        self.repository.add_ac_bill(bill)
        return bill

    # Helpers --------------------------------------------------------------
    def _rate_for_speed(self, speed: str) -> float:
        return self.rate_map.get(speed, self.rate_map["MID"])

    def _accommodation_elapsed_seconds(self, room_id: str) -> Optional[int]:
        if not self.time_manager:
            return None
        order = self.repository.get_latest_accommodation_order(room_id)
        timer_id = order.get("timer_id") if order else None
        if not timer_id:
            return None
        timer_handle = self.time_manager.get_timer_by_id(timer_id)
        if not timer_handle or not timer_handle.is_valid:
            return None
        return timer_handle.elapsed_seconds
