"""Reporting service placeholder for aggregated statistics."""
from __future__ import annotations

from datetime import datetime

from app.config import AppConfig


class ReportService:
    def __init__(self, config: AppConfig):
        self.config = config

    def build_report(self, start: datetime, end: datetime):
        raise NotImplementedError("Reporting metrics will be implemented in later iterations.")
