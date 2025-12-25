import { useEffect, useMemo, useState } from "react";
import { frontdeskClient } from "../api/frontdeskClient";
import { monitorClient } from "../api/monitorClient";
import type { RoomStatus } from "../types/rooms";

export function CheckInPage() {
  const [form, setForm] = useState({
    customerName: "",
    roomId: "",
    nights: 1,
    deposit: 0,
  });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomStatuses, setRoomStatuses] = useState<RoomStatus[]>([]);

  const rooms = useMemo(
    () => Array.from({ length: 100 }, (_, i) => String(i + 1)),
    []
  );

  // 已入住（occupied）集合
  const occupiedSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of roomStatuses) {
      const st = String(r.status || "").toLowerCase();
      if (st === "serving" || st === "waiting" || st === "occupied") set.add(String(r.roomId));
    }
    return set;
  }, [roomStatuses]);

  const loadStatuses = () => {
    monitorClient.fetchRooms().then(({ data, error }) => {
      if (error) {
        // 不打断流程，仅在界面上提示
        setError(error);
        return;
      }
      setRoomStatuses(data?.rooms ?? []);
    });
  };

  useEffect(() => {
    loadStatuses();
  }, []);

  const handleSelectRoom = (id: string) => {
    setSelectedRoomId(id);
    setForm((prev) => ({ ...prev, roomId: id }));
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedName = form.customerName.trim();
    if (!trimmedName) {
      setError("请填写住客姓名");
      return;
    }

    const roomNum = Number(form.roomId);
    if (!roomNum || roomNum < 1 || roomNum > 100) {
      setError("请从右侧矩阵选择 1-100 的房间");
      return;
    }

    if (occupiedSet.has(String(roomNum))) {
      setError("该房间已入住，无法办理入住");
      return;
    }

    if (form.nights < 1) {
      setError("入住天数至少为 1");
      return;
    }

    if (form.deposit < 0) {
      setError("押金不能为负数");
      return;
    }

    const { data, error } = await frontdeskClient.checkIn({
      custId: `TEMP-${Date.now()}`,
      custName: trimmedName,
      guestCount: 1,
      checkInDate: new Date().toISOString(),
      roomId: form.roomId,
      deposit: form.deposit,
    });

    if (error) {
      setError(error);
      return;
    }

    if (data) {
      setResult(
        `已为房间 ${data.roomId} 创建订单 ${data.orderId}，状态：${data.status}`
      );
      setError(null);
      loadStatuses();
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl py-12">
      <header className="mb-8 text-center">
        <h2 className="text-4xl font-semibold">办理入住流程</h2>
        <p className="text-sm text-slate-500">
          选择房间并填写入住信息，生成入住订单与房卡。
        </p>
      </header>

      {/* 小/中屏上下布局，大屏左右布局 */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* 左侧：办理入住表单 */}
        <form
          className="space-y-4 rounded-2xl border border-white/70 bg-white p-8 shadow-sm"
          onSubmit={handleSubmit}
        >
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {result}
            </div>
          )}

          <label className="flex flex-col gap-2 text-sm">
            住客姓名
            <input
              placeholder="请输入住客姓名"
              className="rounded-xl border border-slate-200 px-4 py-3 shadow-sm"
              value={form.customerName}
              onChange={(e) =>
                setForm({ ...form, customerName: e.target.value })
              }
            />
          </label>

          <label className="flex flex-col gap-2 text-sm">
            房间号
            <input
              placeholder="请从右侧矩阵选择房间（可手动修改）"
              className="rounded-xl border border-slate-200 px-4 py-3 shadow-sm"
              value={form.roomId}
              onChange={(e) => {
                const v = e.target.value;
                setForm({ ...form, roomId: v });
                const n = Number(v);
                if (Number.isInteger(n) && n >= 1 && n <= 100) {
                  setSelectedRoomId(String(n));
                } else {
                  setSelectedRoomId(null);
                }
              }}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              入住天数
              <input
                type="number"
                min={1}
                className="rounded-xl border border-slate-200 px-4 py-3 shadow-sm"
                value={form.nights}
                onChange={(e) =>
                  setForm({ ...form, nights: Number(e.target.value) })
                }
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              押金（¥）
              <input
                type="number"
                min={0}
                className="rounded-xl border border-slate-200 px-4 py-3 shadow-sm"
                value={form.deposit}
                onChange={(e) =>
                  setForm({ ...form, deposit: Number(e.target.value) })
                }
              />
            </label>
          </div>

          <button
            className="w-full rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:shadow-lg hover:scale-[1.01]"
            type="submit"
          >
            提交并办理入住
          </button>
        </form>

        {/* 右侧：10×10 房间矩阵 */}
        <section className="rounded-2xl border border-white/70 bg-white p-6 shadow-sm flex flex-col items-center">
          <div className="mb-4 flex items-center justify-between w-full">
            <h3 className="text-2xl font-semibold">房间选择</h3>

            {/* 状态说明 */}
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-slate-100 border border-slate-300" />
                未选择（灰）
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-rose-100 border border-rose-300" />
                已选择（红）
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-emerald-100 border border-emerald-300" />
                点击（绿）
              </span>
            </div>
          </div>

          {/* 固定 10×10 房间矩阵 */}
          <div className="grid grid-cols-10 gap-3">
            {rooms.map((id) => {
              const isSelected = selectedRoomId === id; // 绿色：当前选择
              const isOccupied = occupiedSet.has(id); // 红色：已入住

              const base =
                "flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-semibold transition-all cursor-pointer";

              // 颜色优先级：已入住为红底；被选择则增加绿色环，未入住未选择为灰
              const palette = isOccupied
                ? isSelected
                  ? "bg-rose-100 border-rose-300 text-rose-700 ring-2 ring-emerald-400"
                  : "bg-rose-100 border-rose-300 text-rose-700"
                : isSelected
                ? "bg-emerald-100 border-emerald-300 text-emerald-800 ring-2 ring-emerald-400"
                : "bg-slate-100 border-slate-300 text-slate-500 hover:bg-slate-200";

              return (
                <button
                  key={id}
                  type="button"
                  className={`${base} ${palette}`}
                  onClick={() => handleSelectRoom(id)}
                >
                  {id}
                </button>
                
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
