"""SQLModel database configuration."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from sqlmodel import SQLModel, create_engine, Session

DB_PATH = Path(__file__).resolve().parent.parent / "ac_system.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)


def _ensure_rate_column() -> None:
    """Add rate_per_night column if database pre-dates the field."""
    if not DB_PATH.exists():
        return

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute("PRAGMA table_info(roommodel)")
        columns = {row[1] for row in cursor.fetchall()}
        if "rate_per_night" not in columns:
            conn.execute("ALTER TABLE roommodel ADD COLUMN rate_per_night FLOAT DEFAULT 300.0")
            conn.commit()


def init_db() -> None:
    """Create tables if they do not exist and patch legacy schemas."""
    from . import models  # noqa: F401  # ensure SQLModel metadata is loaded

    _ensure_rate_column()
    SQLModel.metadata.create_all(engine)


def SessionLocal() -> Session:
    return Session(engine)
