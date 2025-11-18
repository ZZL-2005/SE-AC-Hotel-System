import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { monitorClient } from "../api/monitorClient";
import type { RoomStatus } from "../types/rooms";

export function RoomSelectorPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRoomId, setModalRoomId] = useState<string | null>(null);

  useEffect(() => {
    monitorClient.fetchRooms().then(({ data, error }) => {
      if (error) {
        setError(error);
        return;
      }
      setRooms(data?.rooms ?? []);
    });
  }, []);

  // 映射房间占用状态
  const occupiedSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) {
      const st = String(r.status || "").toLowerCase();
      if (st === "serving" || st === "waiting" || st === "occupied") set.add(String(r.roomId));
    }
    return set;
  }, [rooms]);

  const handleSelect = (roomId: string) => {
    // 在选择页面：已入住=绿色可进入；未入住=灰色弹窗提示
    if (occupiedSet.has(roomId)) {
      navigate(`/room-control/${roomId}`);
    } else {
      setModalRoomId(roomId);
      setModalOpen(true);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl py-12">
      <header className="mb-8 text-center">
        <h2 className="text-4xl font-semibold">选择房间</h2>
        <p className="text-sm text-slate-500">请选择要控制的房间进入控制面板。</p>
      </header>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <section className="rounded-2xl border border-white/70 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-2xl font-semibold">房态选择</h3>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-100 border border-emerald-300" /> 已入住（绿）</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-slate-100 border border-slate-300" /> 未入住（灰）</span>
          </div>
        </div>

        {/* 固定 1-100 的 10×10 矩阵 */}
        <div className="grid grid-cols-10 gap-3">
          {Array.from({ length: 100 }, (_, i) => String(i + 1)).map((id) => {
            const isOccupied = occupiedSet.has(id);
            const base = "flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-semibold transition-all cursor-pointer";
            const palette = isOccupied
              ? "bg-emerald-100 border-emerald-300 text-emerald-800 hover:shadow hover:scale-[1.01]"
              : "bg-slate-100 border-slate-300 text-slate-500 hover:bg-slate-200";
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleSelect(id)}
                className={[base, palette].join(" ")}
                title={`房间 ${id}`}
              >
                {id}
              </button>
            );
          })}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="rounded-2xl bg-white p-6 shadow-xl w-[90%] max-w-sm">
            <h4 className="mb-2 text-lg font-semibold">提示</h4>
            <p className="mb-6 text-sm text-slate-600">此房间未入住{modalRoomId ? `（${modalRoomId}）` : ""}，无法进入控制面板。</p>
            <div className="flex justify-end gap-3">
              <button
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setModalOpen(false)}
                type="button"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
