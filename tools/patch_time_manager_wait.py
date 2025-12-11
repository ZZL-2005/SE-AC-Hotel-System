from __future__ import annotations

from pathlib import Path


def main() -> None:
    """Patch TimeManager._tick_wait_timers to use fixed time-slice cycles.

    New semantics for WAIT timers:
    - Each waiting room accumulates `elapsed_seconds` independently.
    - Every `time_slice_seconds` (e.g. 120s) of waiting, emit a single
      TIME_SLICE_EXPIRED event for that room.
    - If the scheduler cannot find a victim to preempt at that moment,
      the room simply continues waiting and will emit another event
      after the next full `time_slice_seconds` interval.
    """
    path = Path("backend/application/time_manager.py")
    text = path.read_text(encoding="utf-8")

    marker_start = "    def _tick_wait_timers(self) -> None:\n"
    marker_end = "    def _tick_detail_timers(self) -> None:\n"

    try:
        start = text.index(marker_start)
        end = text.index(marker_end)
    except ValueError as exc:  # pragma: no cover - defensive
        raise SystemExit(f"Markers not found in {path}: {exc}") from exc

    new_block = '''    def _tick_wait_timers(self) -> None:
        """
        推进等待计时 + 时间片轮转调度触发。

        业务语义：
        - 等待中的每个房间独立累积等待时长 elapsed_seconds；
        - 每等待满 `time_slice_seconds`（默认 120s），就触发一次
          TIME_SLICE_EXPIRED 事件，让 Scheduler 尝试做轮转抢占；
        - 如果当前没有合适的 victim（抢不到），则该房间继续等待，
          再等下一个 120s 周期后再次触发事件。

        因此这里把 remaining_seconds 视为“距离下一次尝试轮转的剩余时间”，
        每次归零时发事件并重置一个新的周期。
        """
        if self.time_slice_seconds <= 0:
            return

        for timer_id, state in list(self._timers.items()):
            if state.timer_type != TimerType.WAIT or not state.active:
                continue

            state.elapsed_seconds += 1

            # 初始化 / 继续当前时间片倒计时
            if state.remaining_seconds <= 0:
                state.remaining_seconds = self.time_slice_seconds

            state.remaining_seconds -= 1

            # 等待满一个时间片：发送事件，并开启下一轮计时
            if state.remaining_seconds <= 0:
                self.event_bus.publish_sync(
                    SchedulerEvent(
                        event_type=EventType.TIME_SLICE_EXPIRED,
                        room_id=state.room_id,
                        payload={"speed": state.speed, "timer_id": timer_id},
                    )
                )
                # 下一个 time_slice_seconds 再尝试一次
                state.remaining_seconds = self.time_slice_seconds

'''

    new_text = text[:start] + new_block + text[end:]
    path.write_text(new_text, encoding="utf-8")
    print("Patched TimeManager._tick_wait_timers() with fixed time-slice logic.")


if __name__ == "__main__":
    main()

