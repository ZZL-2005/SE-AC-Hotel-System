from .ac_router import router as ac_router
from .frontdesk_router import router as frontdesk_router
from .monitor_router import router as monitor_router
from .report_router import router as report_router
from .debug_router import router as debug_router

__all__ = [
    "ac_router",
    "frontdesk_router",
    "monitor_router",
    "report_router",
    "debug_router",
]
