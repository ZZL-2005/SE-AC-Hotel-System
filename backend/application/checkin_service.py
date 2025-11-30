"""Check-in workflow service."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from domain.room import Room, RoomStatus

if TYPE_CHECKING:
    from app.config import AppConfig
    from application.billing_service import BillingService
    from application.scheduler import Scheduler
    from infrastructure.repository import RoomRepository


class CheckInService:
    def __init__(
        self,
        config: AppConfig,
        repository: RoomRepository,
        scheduler: Scheduler,
        billing_service: BillingService,
    ):
        self.config = config
        self.repo = repository
        self.scheduler = scheduler
        self.billing_service = billing_service

    def _default_temperature(self) -> float:
        return float((self.config.temperature or {}).get("default_target", 25.0))

    def _get_or_create_room(self, room_id: str) -> Room:
        room = self.repo.get_room(room_id)
        if room:
            return room
        default_temp = self._default_temperature()
        new_room = Room(
            room_id=room_id,
            current_temp=default_temp,
            target_temp=default_temp,
            initial_temp=default_temp,
        )
        self.repo.save_room(new_room)
        return new_room

    def check_in(
        self,
        room_id: str,
        cust_id: str,
        cust_name: str,
        guest_count: int,
        check_in_date_str: str,
        deposit: float,
    ) -> dict:
        """
        办理入住登记。
        """
        room = self._get_or_create_room(room_id)
        self.scheduler.cancel_request(room_id)
        self.billing_service.close_current_detail_record(room_id, datetime.utcnow())

        initial_temp = room.current_temp
        room.initial_temp = initial_temp
        room.current_temp = initial_temp
        room.target_temp = initial_temp
        room.speed = "MID"
        room.total_fee = 0.0
        room.is_serving = False
        room.status = RoomStatus.OCCUPIED
        self.repo.save_room(room)

        # 解析入住日期
        try:
            check_in_time = datetime.fromisoformat(check_in_date_str.replace('Z', '+00:00'))
        except ValueError:
            check_in_time = datetime.utcnow()

        order_id = str(uuid4())
        self.repo.add_accommodation_order(
            {
                "order_id": order_id,
                "room_id": room_id,
                "customer_id": cust_id,
                "customer_name": cust_name,
                "guest_count": guest_count,
                "nights": 1,
                "deposit": deposit,
                "check_in_at": check_in_time,
            }
        )

        return {
            "orderId": order_id,
            "roomId": room_id,
            "custId": cust_id,
            "custName": cust_name,
            "guestCount": guest_count,
            "checkInDate": check_in_time.isoformat(),
            "deposit": deposit,
            "initialTemp": initial_temp,
            "status": "CHECKED_IN",
        }
