import type { RoomStatus } from "../types/rooms";

const statusCopy: Record<string, { label: string; tone: string }> = {
  serving: { label: "服务中", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  waiting: { label: "等待中", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  occupied: { label: "已入住", tone: "bg-indigo-50 text-indigo-700 border-indigo-200" },
};

export function RoomStatusGrid({ rooms }: { rooms: RoomStatus[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-semibold text-slate-900">房间运行态势</h3>
          <p className="text-sm text-slate-500">仅展示在住或存在调度请求的房间</p>
        </div>
        <span className="text-xs uppercase tracking-[0.4em] text-slate-400">Auto Refresh</span>
      </div>

      {rooms.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
          暂无在住客房或调度请求。
        </div>
      ) : (
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => {
            const key = room.status?.toLowerCase?.() ?? "";
            const tone = statusCopy[key] ?? statusCopy.occupied;
            const diff = Number((room.currentTemp - room.targetTemp).toFixed(1));
            return (
              <article
                key={room.roomId}
                className="group rounded-3xl border border-slate-100 bg-gradient-to-br from-white to-slate-50/80 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-slate-400">房间 #{room.roomId}</p>
                    <h4 className="text-xl font-semibold text-slate-900">{tone.label}</h4>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone.tone}`}>{room.speed ?? "--"}</span>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className="text-sm text-slate-500">当前温度</p>
                    <p className="text-3xl font-semibold text-slate-900">{room.currentTemp.toFixed(1)}℃</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-500">目标</p>
                    <p className="text-xl font-semibold text-slate-900">{room.targetTemp.toFixed(1)}℃</p>
                    <p className="text-xs text-slate-500">偏差 {diff > 0 ? `+${diff}` : diff}℃</p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
                  <div>
                    <dt className="text-slate-400">本次费用</dt>
                    <dd className="font-semibold text-slate-900">¥{room.currentFee.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">累计费用</dt>
                    <dd className="font-semibold text-slate-900">¥{room.totalFee.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">服务时长</dt>
                    <dd>{room.servedSeconds}s</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">等待时长</dt>
                    <dd>{room.waitedSeconds}s</dd>
                  </div>
                </dl>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  <span>服务中：{room.isServing ? "是" : "否"}</span>
                  <span>等待中：{room.isWaiting ? "是" : "否"}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
