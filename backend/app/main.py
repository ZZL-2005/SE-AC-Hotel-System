"""FastAPI entry point for the Hotel Central AC Billing System."""
from fastapi import FastAPI
import asyncio
import contextlib

from interfaces import ac_router, frontdesk_router, monitor_router, report_router
from interfaces import deps

app = FastAPI(title="Hotel Central AC Billing System")

app.include_router(ac_router)
app.include_router(frontdesk_router)
app.include_router(monitor_router)
app.include_router(report_router)

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],  # 支持前端在不同端口运行
    allow_credentials=True,
    allow_methods=["*"],  # 必须，解决 OPTIONS 问题
    allow_headers=["*"],
)
@app.get("/health", tags=["health"])
def health_check() -> dict:
    """Expose a minimal health endpoint to help dev tooling."""
    return {"status": "ok", "configVersion": deps.settings.version}


# Background scheduler ticker ----------------------------------------------
@app.on_event("startup")
async def _start_scheduler_loop() -> None:  # pragma: no cover - runtime wiring
    async def _loop():
        while True:
            deps.scheduler.tick_1s()
            clock_cfg = deps.settings.clock or {}
            ratio = float(clock_cfg.get("ratio", 1.0))
            if ratio <= 0:
                ratio = 1.0
            await asyncio.sleep(max(0.01, 1.0 / ratio))

    app.state._scheduler_task = asyncio.create_task(_loop())


@app.on_event("shutdown")
async def _stop_scheduler_loop() -> None:  # pragma: no cover - runtime wiring
    task = getattr(app.state, "_scheduler_task", None)
    if task:
        task.cancel()
        with contextlib.suppress(Exception):
            await task
