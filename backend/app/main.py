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


# Background tasks ----------------------------------------------
@app.on_event("startup")
async def _start_background_tasks() -> None:  # pragma: no cover - runtime wiring
    """启动后台任务：事件消费循环 + 时钟推进循环"""
    
    # 启动异步事件消费循环
    await deps.event_bus.start()
    
    # 时钟推进循环（调用 TimeManager.tick()）
    async def _clock_loop():
        while True:
            # 每次调用推进 1 秒逻辑时间
            deps.time_manager.tick()
            # 调用间隔由 TimeManager 控制（可通过 API 调整）
            interval = deps.time_manager.get_tick_interval()
            await asyncio.sleep(interval)

    app.state._clock_task = asyncio.create_task(_clock_loop())
    print("[main] Background tasks started: EventBus + TimeManager clock")


@app.on_event("shutdown")
async def _stop_background_tasks() -> None:  # pragma: no cover - runtime wiring
    """停止后台任务"""
    # 停止时钟循环
    clock_task = getattr(app.state, "_clock_task", None)
    if clock_task:
        clock_task.cancel()
        with contextlib.suppress(Exception):
            await clock_task
    
    # 停止事件消费循环
    await deps.event_bus.stop()
    print("[main] Background tasks stopped")
