import { useEffect, useMemo, useState } from "react";
import { RoomStatusGrid } from "../components";
import { monitorClient } from "../api/monitorClient";
import type { RoomStatus } from "../types/rooms";

type QueuePanelProps = {
  serving: RoomStatus[];
  waiting: RoomStatus[];
};

function QueuePanel({ serving, waiting }: QueuePanelProps) {
  const maxSlots = 3; // PPT 默认并发上限，可在未来接入配置
  const utilization = Math.min(1, serving.length / maxSlots);
  return (
    <section className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">调度队列</p>
          <h3 className="text-xl font-semibold text-slate-900">实时服务资源占用</h3>
        </div>
        <div className="text-right text-sm text-slate-600">
          <p>
            服务中 <span className="font-semibold text-slate-900">{serving.length}</span> / {maxSlots}
          </p>
          <p>
            等待中 <span className="font-semibold text-slate-900">{waiting.length}</span>
          </p>
        </div>
      </div>
      <div className="my-4 h-3 w-full rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 via-blue-500 to-emerald-400 transition-[width]" style={{ width: `${utilization * 100}%` }} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-indigo-900">服务中的房间</p>
            <span className="text-xs text-indigo-600">{serving.length} 个</span>
          </div>
          <ul className="space-y-2 text-sm text-indigo-900">
            {serving.length === 0 && <li className="text-indigo-500">暂无服务请求</li>}
            {serving.map((room) => (
              <li key={room.roomId} className="rounded-xl bg-white/80 px-3 py-2 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">#{room.roomId}</span>
                  <span className="text-xs">{room.serviceSpeed ?? room.speed ?? "-"}</span>
                </div>
                <p className="text-xs text-indigo-500">已服务 {room.servedSeconds}s</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-amber-900">等待队列</p>
            <span className="text-xs text-amber-600">{waiting.length} 个</span>
          </div>
          <ul className="space-y-2 text-sm text-amber-900">
            {waiting.length === 0 && <li className="text-amber-600">暂无等待请求</li>}
            {waiting.map((room) => (
              <li key={room.roomId} className="rounded-xl bg-white/80 px-3 py-2 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">#{room.roomId}</span>
                  <span className="text-xs">{room.waitSpeed ?? room.speed ?? "-"}</span>
                </div>
                <p className="text-xs text-amber-600">累计等待 {room.waitedSeconds}s</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function MonitorPage() {
  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await monitorClient.fetchRooms();
      if (cancelled) return;
      if (error) {
        setError(error);
        return;
      }
      setRooms(data?.rooms ?? []);
      setLastUpdated(new Date());
      setError(null);
    };
    load();
    const interval = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const activeRooms = useMemo(() => rooms.filter((room) => room.status !== "idle" || room.isServing || room.isWaiting), [rooms]);
  const serving = useMemo(() => rooms.filter((room) => room.isServing), [rooms]);
  const waiting = useMemo(() => rooms.filter((room) => room.isWaiting), [rooms]);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">房间实时总览</p>
            <h2 className="text-3xl font-semibold text-slate-900">中央空调监控面板</h2>
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>当前展示：{activeRooms.length} 间客房</p>
            <p>上次刷新：{lastUpdated ? lastUpdated.toLocaleTimeString() : "--"}</p>
          </div>
        </div>
      </div>

      <QueuePanel serving={serving} waiting={waiting} />
      <RoomStatusGrid rooms={activeRooms} />
    </div>
  );
}
