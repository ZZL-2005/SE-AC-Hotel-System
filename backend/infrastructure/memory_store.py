"""In-memory data store intended for the prototype stage."""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, TYPE_CHECKING

from domain.room import Room
from domain.detail_record import ACDetailRecord
from domain.bill import ACBill
from .repository import RoomRepository

if TYPE_CHECKING:  # pragma: no cover
    from application.scheduler import ServiceObject


class InMemoryRoomRepository(RoomRepository):
    def __init__(self):
        self._rooms: Dict[str, Room] = {}
        self._services: Dict[str, "ServiceObject"] = {}
        self._wait_entries: Dict[str, "ServiceObject"] = {}
        self._detail_records: Dict[str, ACDetailRecord] = {}
        self._room_detail_history: Dict[str, List[str]] = {}
        self._ac_bills: Dict[str, List[ACBill]] = {}
        self._accommodation_orders: List[dict] = []
        self._accommodation_bills: List[dict] = []

    def get_room(self, room_id: str) -> Optional[Room]:
        return self._rooms.get(room_id)

    def list_rooms(self) -> Iterable[Room]:
        return self._rooms.values()

    def save_room(self, room: Room) -> None:
        self._rooms[room.room_id] = room

    def add_service_object(self, service: "ServiceObject") -> None:
        self._services[service.room_id] = service

    def update_service_object(self, service: "ServiceObject") -> None:
        self._services[service.room_id] = service

    def remove_service_object(self, room_id: str) -> None:
        self._services.pop(room_id, None)

    def add_wait_entry(self, service: "ServiceObject") -> None:
        self._wait_entries[service.room_id] = service

    def remove_wait_entry(self, room_id: str) -> None:
        self._wait_entries.pop(room_id, None)

    def list_wait_entries(self) -> Iterable["ServiceObject"]:
        return self._wait_entries.values()

    def add_detail_record(self, record: ACDetailRecord) -> None:
        self._detail_records[record.record_id] = record
        self._room_detail_history.setdefault(record.room_id, []).append(record.record_id)

    def update_detail_record(self, record: ACDetailRecord) -> None:
        self._detail_records[record.record_id] = record

    def get_active_detail_record(self, room_id: str) -> Optional[ACDetailRecord]:
        ids = self._room_detail_history.get(room_id, [])
        for record_id in reversed(ids):
            record = self._detail_records[record_id]
            if record.ended_at is None:
                return record
        return None

    def list_completed_detail_records(self, room_id: str) -> Iterable[ACDetailRecord]:
        ids = self._room_detail_history.get(room_id, [])
        for record_id in ids:
            record = self._detail_records[record_id]
            if record.ended_at:
                yield record

    def add_ac_bill(self, bill: ACBill) -> None:
        self._ac_bills.setdefault(bill.room_id, []).append(bill)

    def list_ac_bills(self, room_id: str) -> Iterable[ACBill]:
        return self._ac_bills.get(room_id, [])

    def add_accommodation_order(self, order: dict) -> None:
        self._accommodation_orders.append(order)

    def add_accommodation_bill(self, bill: dict) -> None:
        self._accommodation_bills.append(bill)
