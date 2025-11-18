"""Check-out workflow service placeholder."""
from __future__ import annotations

from app.config import AppConfig


class CheckOutService:
    def __init__(self, config: AppConfig):
        self.config = config

    def check_out(self, room_id: str) -> None:
        raise NotImplementedError("Checkout plus billing logic pending implementation.")
