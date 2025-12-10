"""SQLModel ORM tables mirroring the domain entities."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class RoomModel(SQLModel, table=True):
    room_id: str = Field(primary_key=True)
    status: str = Field(default="VACANT")
    current_temp: float = Field(default=25.0)
    target_temp: float = Field(default=25.0)
    initial_temp: float = Field(default=25.0)
    mode: str = Field(default="cool")
    speed: str = Field(default="MID")
    is_serving: bool = Field(default=False)
    ac_enabled: bool = Field(default=False)  # 空调是否被用户开启
    total_fee: float = Field(default=0.0)
    rate_per_night: float = Field(default=300.0)
    active_service_id: Optional[str] = Field(default=None)
    last_temp_change_timestamp: Optional[datetime] = None
    pending_target_temp: Optional[float] = None
    manual_powered_off: bool = Field(default=False)


class ServiceObjectModel(SQLModel, table=True):
    room_id: str = Field(primary_key=True)
    speed: str
    started_at: Optional[datetime] = None
    served_seconds: int = 0
    wait_seconds: int = 0
    total_waited_seconds: int = 0
    priority_token: int = 0
    time_slice_enforced: bool = False
    status: str = Field(default="WAITING")
    current_fee: float = 0.0


class WaitEntryModel(SQLModel, table=True):
    room_id: str = Field(primary_key=True)
    speed: str
    wait_seconds: int = 0
    total_waited_seconds: int = 0
    priority_token: int = 0
    time_slice_enforced: bool = False  # 添加时间片轮转标记
    requested_at: datetime = Field(default_factory=datetime.utcnow)


class ACDetailRecordModel(SQLModel, table=True):
    record_id: str = Field(primary_key=True)
    room_id: str = Field(index=True)
    speed: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    rate_per_min: float = 0.0
    fee_value: float = 0.0


class ACBillModel(SQLModel, table=True):
    bill_id: str = Field(primary_key=True)
    room_id: str = Field(index=True)
    period_start: datetime
    period_end: datetime
    total_fee: float = 0.0


class AccommodationOrderModel(SQLModel, table=True):
    order_id: str = Field(primary_key=True)
    room_id: str = Field(index=True)
    customer_name: str
    nights: int
    deposit: float
    check_in_at: datetime


class AccommodationBillModel(SQLModel, table=True):
    bill_id: str = Field(primary_key=True)
    room_id: str = Field(index=True)
    total_fee: float
    created_at: datetime
