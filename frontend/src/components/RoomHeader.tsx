type RoomHeaderProps = {
  roomId: string;
  status: "SERVING" | "WAITING" | "IDLE";
  mode: "cool" | "heat";
};

const statusCopy = {
  SERVING: "服务中",
  WAITING: "等待中",
  IDLE: "空闲",
};

export function RoomHeader({ roomId, status, mode }: RoomHeaderProps) {
  return (
    <header className="flex flex-col gap-2 rounded-xl border border-slate-200 p-6 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm uppercase tracking-[0.3em] text-brand-muted">房间</p>
        <h2 className="text-3xl font-semibold">{roomId}</h2>
      </div>
      <div className="space-y-1 text-sm text-slate-500">
        <div>
          <span className="font-medium text-brand-primary">状态：</span> {statusCopy[status]}
        </div>
        <div>
          <span className="font-medium text-brand-primary">模式：</span> {mode === "cool" ? "制冷" : "制热"}
        </div>
      </div>
    </header>
  );
}
