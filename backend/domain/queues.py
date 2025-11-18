"""Simple in-memory queue representations for scheduler orchestration."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .service_object import ServiceObject


@dataclass
class ServiceQueue:
    items: List[ServiceObject] = field(default_factory=list)

    def add(self, service: ServiceObject) -> None:
        self.items.append(service)

    def remove(self, service: ServiceObject) -> None:
        self.items = [item for item in self.items if item.service_id != service.service_id]


@dataclass
class WaitingQueue(ServiceQueue):
    pass
