"""SQLModel database configuration."""
from __future__ import annotations

from pathlib import Path
from sqlmodel import SQLModel, create_engine, Session

DB_PATH = Path(__file__).resolve().parent.parent / "ac_system.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    """Create tables if they do not exist."""
    from . import models  # noqa: F401  # ensure SQLModel metadata is loaded

    SQLModel.metadata.create_all(engine)


def SessionLocal() -> Session:
    return Session(engine)
