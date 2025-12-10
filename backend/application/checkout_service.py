"""Check-out workflow service."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import uuid4

from domain.room import RoomStatus

if TYPE_CHECKING:
    from app.config import AppConfig
    from application.billing_service import BillingService
    from application.time_manager import TimeManager
    from application.use_ac_service import UseACService
    from infrastructure.repository import RoomRepository


class CheckOutService:
    def __init__(
        self,
        config: "AppConfig",
        repository: "RoomRepository",
        billing_service: "BillingService",
        ac_service: "UseACService",
        time_manager: Optional["TimeManager"] = None,
    ):
        self.config = config
        self.repo = repository
        self.billing_service = billing_service
        self.ac_service = ac_service
        self.time_manager = time_manager

    def set_time_manager(self, time_manager: "TimeManager") -> None:
        """设置时间管理器（后置注入）"""
        self.time_manager = time_manager

    def _default_temperature(self) -> float:
        return float((self.config.temperature or {}).get("default_target", 25.0))

    def _accommodation_rate(self) -> float:
        return float((self.config.accommodation or {}).get("rate_per_night", 300.0))

    def check_out(self, room_id: str) -> dict:
        """
        办理退房结账。
        """
        room = self.repo.get_room(room_id)
        if not room:
            raise ValueError("Room not found")

        # Ensure service + wait entries cleaned and detail segments closed
        self.ac_service.power_off(room_id)
        if hasattr(self.repo, "remove_wait_entry"):
            self.repo.remove_wait_entry(room_id)

        order = self.repo.get_latest_accommodation_order(room_id)
        if not order:
            raise ValueError("Room has no active accommodation order.")

        nights = order["nights"]
        deposit = order["deposit"]
        
        # 从 TimeManager 获取实际入住时长（如果有计时器）
        accommodation_seconds = 0
        timer_id = order.get("timer_id")
        if timer_id and self.time_manager:
            timer_handle = self.time_manager.get_timer_by_id(timer_id)
            if timer_handle and timer_handle.is_valid:
                accommodation_seconds = timer_handle.elapsed_seconds
                timer_handle.cancel()
        
        # 如果有计时器数据，用实际时长计算天数（向上取整）
        if accommodation_seconds > 0:
            actual_nights = max(1, (accommodation_seconds + 86399) // 86400)  # 向上取整到天
        else:
            actual_nights = nights

        rate = self._accommodation_rate()
        room_fee = float(actual_nights) * rate
        deposit = float(deposit)

        ac_bill = self.billing_service.aggregate_records_to_bill(room_id)
        ac_fee = ac_bill.total_fee if ac_bill else 0.0
        detail_records = ac_bill.details if ac_bill else []

        accommodation_bill_id = str(uuid4())
        accommodation_bill = {
            "bill_id": accommodation_bill_id,
            "room_id": room_id,
            "total_fee": room_fee,
            "created_at": datetime.utcnow(),
        }
        self.repo.add_accommodation_bill(accommodation_bill)

        total_due = room_fee + ac_fee - deposit

        room.status = RoomStatus.VACANT
        room.is_serving = False
        room.speed = "MID"
        room.target_temp = self._default_temperature()
        room.total_fee = 0.0
        self.repo.save_room(room)

        # Serialize AC bill
        ac_bill_data = None
        if ac_bill:
            ac_bill_data = {
                "billId": ac_bill.bill_id,
                "roomId": ac_bill.room_id,
                "periodStart": ac_bill.period_start.isoformat(),
                "periodEnd": ac_bill.period_end.isoformat(),
                "totalFee": ac_bill.total_fee,
            }

        return {
            "roomId": room_id,
            "accommodationBill": {
                "billId": accommodation_bill_id,
                "roomFee": room_fee,
                "nights": actual_nights,
                "ratePerNight": rate,
                "deposit": deposit,
                "accommodationSeconds": accommodation_seconds,
            },
            "acBill": ac_bill_data,
            "detailRecords": [
                {
                    "recordId": rec.record_id,
                    "roomId": rec.room_id,
                    "speed": rec.speed,
                    "startedAt": rec.started_at.isoformat(),
                    "endedAt": rec.ended_at.isoformat() if rec.ended_at else None,
                    "ratePerMin": rec.rate_per_min,
                    "feeValue": rec.fee_value,
                }
                for rec in detail_records
            ],
            "totalDue": total_due,
        }

    def get_room_bills(self, room_id: str) -> dict:
        """
        获取房间账单信息。
        """
        accommodation_bill = self.repo.get_latest_accommodation_bill(room_id)
        
        ac_bills = list(self.repo.list_ac_bills(room_id))
        ac_bill = ac_bills[-1] if ac_bills else None
        
        detail_records = ac_bill.details if ac_bill else []

        acc_bill_data = None
        if accommodation_bill:
            acc_bill_data = {
                "billId": accommodation_bill["bill_id"],
                "roomId": accommodation_bill["room_id"],
                "totalFee": accommodation_bill["total_fee"],
                "createdAt": accommodation_bill["created_at"].isoformat(),
            }

        ac_bill_data = None
        if ac_bill:
            ac_bill_data = {
                "billId": ac_bill.bill_id,
                "roomId": ac_bill.room_id,
                "periodStart": ac_bill.period_start.isoformat(),
                "periodEnd": ac_bill.period_end.isoformat(),
                "totalFee": ac_bill.total_fee,
            }

        return {
            "roomId": room_id,
            "accommodationBill": acc_bill_data,
            "acBill": ac_bill_data,
            "detailRecords": [
                {
                    "recordId": rec.record_id,
                    "roomId": rec.room_id,
                    "speed": rec.speed,
                    "startedAt": rec.started_at.isoformat(),
                    "endedAt": rec.ended_at.isoformat() if rec.ended_at else None,
                    "ratePerMin": rec.rate_per_min,
                    "feeValue": rec.fee_value,
                }
                for rec in detail_records
            ],
        }
