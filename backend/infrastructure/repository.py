"""Abstract repository interfaces for persistence."""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Iterable, Optional, TYPE_CHECKING

from domain.room import Room

if TYPE_CHECKING:  # pragma: no cover
    from domain.service_object import ServiceObject
    from domain.detail_record import ACDetailRecord
    from domain.bill import ACBill


class RoomRepository(ABC):
    """Unified gateway so memory store / SQLite share the same API."""

    @abstractmethod
    def get_room(self, room_id: str) -> Optional[Room]:
        raise NotImplementedError

    @abstractmethod
    def list_rooms(self) -> Iterable[Room]:
        raise NotImplementedError

    @abstractmethod
    def save_room(self, room: Room) -> None:
        raise NotImplementedError

    # Service queue -------------------------------------------------------
    @abstractmethod
    def add_service_object(self, service: "ServiceObject") -> None:
        raise NotImplementedError

    @abstractmethod
    def update_service_object(self, service: "ServiceObject") -> None:
        raise NotImplementedError

    @abstractmethod
    def remove_service_object(self, room_id: str) -> None:
        raise NotImplementedError

    # Waiting queue -------------------------------------------------------
    @abstractmethod
    def add_wait_entry(self, service: "ServiceObject") -> None:
        raise NotImplementedError

    @abstractmethod
    def remove_wait_entry(self, room_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def list_wait_entries(self) -> Iterable["ServiceObject"]:
        raise NotImplementedError

    # Billing -------------------------------------------------------------
    @abstractmethod
    def add_detail_record(self, record: "ACDetailRecord") -> None:
        raise NotImplementedError

    @abstractmethod
    def update_detail_record(self, record: "ACDetailRecord") -> None:
        raise NotImplementedError

    @abstractmethod
    def get_active_detail_record(self, room_id: str) -> Optional["ACDetailRecord"]:
        raise NotImplementedError

    @abstractmethod
    def list_completed_detail_records(self, room_id: str) -> Iterable["ACDetailRecord"]:
        raise NotImplementedError

    @abstractmethod
    def add_ac_bill(self, bill: "ACBill") -> None:
        raise NotImplementedError

    @abstractmethod
    def list_ac_bills(self, room_id: str) -> Iterable["ACBill"]:
        raise NotImplementedError

    # Accommodation -------------------------------------------------------
    @abstractmethod
    def add_accommodation_order(self, order: dict) -> None:
        raise NotImplementedError

    @abstractmethod
    def get_latest_accommodation_order(self, room_id: str) -> Optional[dict]:
        raise NotImplementedError

    @abstractmethod
    def add_accommodation_bill(self, bill: dict) -> None:
        raise NotImplementedError

    @abstractmethod
    def get_latest_accommodation_bill(self, room_id: str) -> Optional[dict]:
        raise NotImplementedError

    # Meal orders ---------------------------------------------------------
    @abstractmethod
    def add_meal_order(self, order: dict) -> None:
        raise NotImplementedError

    @abstractmethod
    def list_meal_orders(self, room_id: str, since: "datetime | None" = None) -> Iterable[dict]:
        """列出房间的订餐记录，可选过滤入住时间之后的"""
        raise NotImplementedError

    @abstractmethod
    def get_meal_total_fee(self, room_id: str, since: "datetime | None" = None) -> float:
        """获取房间订餐总费用"""
        raise NotImplementedError
