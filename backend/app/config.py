"""Configuration loader that keeps all runtime constants centralized."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

try:
    import yaml
except ImportError as exc:  # pragma: no cover - library is optional until runtime
    raise RuntimeError("PyYAML is required to load the application configuration") from exc


CONFIG_PATH = Path(__file__).resolve().parent / "app_config.yaml"


@dataclass(frozen=True)
class AppConfig:
    """Strongly-typed wrapper over the raw YAML document."""

    raw: Dict[str, Any]

    @property
    def version(self) -> str:
        return str(self.raw.get("version", "v1"))

    @property
    def temperature(self) -> Dict[str, Any]:
        return self.raw.get("temperature", {})

    @property
    def billing(self) -> Dict[str, Any]:
        return self.raw.get("billing", {})

    @property
    def scheduling(self) -> Dict[str, Any]:
        return self.raw.get("scheduling", {})

    @property
    def throttle(self) -> Dict[str, Any]:
        return self.raw.get("throttle", {})

    @property
    def accommodation(self) -> Dict[str, Any]:
        return self.raw.get("accommodation", {})

    @property
    def clock(self) -> Dict[str, Any]:
        return self.raw.get("clock", {})


@lru_cache(maxsize=1)
def get_settings(path: Path | None = None) -> AppConfig:
    """Load configuration once per process."""

    config_path = path or CONFIG_PATH
    data = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):  # pragma: no cover - invalid file guard
        raise ValueError("Configuration file must define a mapping at the top level.")
    return AppConfig(raw=data)
