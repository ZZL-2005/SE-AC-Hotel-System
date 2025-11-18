"""Check-in workflow service placeholder."""
from __future__ import annotations

from app.config import AppConfig


class CheckInService:
    def __init__(self, config: AppConfig):
        self.config = config

    def check_in(self, customer: dict, room_id: str, nights: int, deposit: float) -> None:
        raise NotImplementedError("Check-in orchestration to be implemented later.")
