"""内存队列实现，速度最快，但服务重启后数据丢失。"""
from __future__ import annotations

from typing import Dict, List, Optional

from domain.queues import ServiceQueue, WaitingQueue
from domain.service_object import ServiceObject


class InMemoryServiceQueue(ServiceQueue):
    """服务队列的内存实现"""

    def __init__(self) -> None:
        self._data: Dict[str, ServiceObject] = {}

    def add(self, service: ServiceObject) -> None:
        self._data[service.room_id] = service

    def remove(self, room_id: str) -> None:
        self._data.pop(room_id, None)

    def get(self, room_id: str) -> Optional[ServiceObject]:
        return self._data.get(room_id)

    def list_all(self) -> List[ServiceObject]:
        return list(self._data.values())

    def update(self, service: ServiceObject) -> None:
        self._data[service.room_id] = service

    def size(self) -> int:
        return len(self._data)

    def clear(self) -> None:
        self._data.clear()


class InMemoryWaitingQueue(WaitingQueue):
    """等待队列的内存实现"""

    def __init__(self) -> None:
        self._data: Dict[str, ServiceObject] = {}

    def add(self, service: ServiceObject) -> None:
        self._data[service.room_id] = service

    def remove(self, room_id: str) -> None:
        self._data.pop(room_id, None)

    def get(self, room_id: str) -> Optional[ServiceObject]:
        return self._data.get(room_id)

    def list_all(self) -> List[ServiceObject]:
        return list(self._data.values())

    def update(self, service: ServiceObject) -> None:
        self._data[service.room_id] = service

    def size(self) -> int:
        return len(self._data)

    def clear(self) -> None:
        self._data.clear()

