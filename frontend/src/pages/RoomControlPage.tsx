import { useCallback, useEffect, useRef, useState, useId } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FeePanel, RoomHeader, SpeedSelector, TempGauge } from "../components";
import { acClient, type RoomStateResponse } from "../api/acClient";
import { frontdeskClient, type CheckOutResponse } from "../api/frontdeskClient";

// 新增：折线图
type TempPoint = { time: string; temp: number };

function TempHistoryChart({ points }: { points: TempPoint[] }) {
  const gradientId = useId();
  const areaId = `${gradientId}-area`;
  if (points.length < 2) {
    return (
      <div className="flex h-[90%] w-full items-center justify-center text-xs text-slate-400">
        收集中，稍后再看~
      </div>
    );
  }

  const temps = points.map((p) => p.temp);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const padding = Math.max(0.5, (max - min) * 0.15);
  const yMin = min - padding;
  const yMax = max + padding;
  const range = yMax - yMin || 1;
  const width = 480;
  const height = 180;
  const stepX = width / (points.length - 1);

  const linePath = points
    .map((point, index) => {
      const x = index * stepX;
      const y = height - ((point.temp - yMin) / range) * height;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const latest = points[points.length - 1];
  const latestX = (points.length - 1) * stepX;
  const latestY = height - ((latest.temp - yMin) / range) * height;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8884ff" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
        <filter id={areaId} x="-5%" y="-5%" width="110%" height="120%">
          <feDropShadow dx="0" dy="5" stdDeviation="5" floodOpacity="0.1" />
        </filter>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} filter={`url(#${areaId})`} />
      <path d={linePath} fill="none" stroke="#6366f1" strokeWidth={3} strokeLinecap="round" />
      <circle cx={latestX} cy={latestY} r={5} fill="#6366f1" />
      <text x={latestX - 4} y={latestY - 10} fontSize="12" fill="#475569">
        {latest.temp.toFixed(1)}℃
      </text>
      <text x={0} y={14} fontSize="12" fill="#94a3b8">
        高 {yMax.toFixed(1)}℃
      </text>
      <text x={0} y={height - 4} fontSize="12" fill="#94a3b8">
        低 {yMin.toFixed(1)}℃
      </text>
    </svg>
  );
}

export function RoomControlPage() {
  const navigate = useNavigate();
  const params = useParams();
  const roomId = params.roomId ?? "";

  const [roomState, setRoomState] = useState<RoomStateResponse | null>(null);
  const [mode, setMode] = useState<"cool" | "heat">("cool");
  const [speed, setSpeed] = useState("MID");
  const [targetInput, setTargetInput] = useState(24);
  const [message, setMessage] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckOutResponse | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [isPoweredOn, setIsPoweredOn] = useState(false);
  const [autoDispatching, setAutoDispatching] = useState(false);
  const throttleRef = useRef<number | null>(null);

  // 新增：温度历史记录
  const [tempHistory, setTempHistory] = useState<
    { time: string; temp: number }[]
  >([]);

  const applyResponse = (state?: RoomStateResponse | null) => {
    if (!state) return;

    setRoomState(state);

    if (state.mode === "cool" || state.mode === "heat") setMode(state.mode);
    if (state.speed) setSpeed(state.speed);
    if (typeof state.targetTemp === "number") {
      setTargetInput(state.targetTemp);
    }
    if (state.isServing || state.isWaiting) {
      setIsPoweredOn(true);
    }

    // --- 新增：记录温度变化数据 ---
    const incomingTemp = state.currentTemp;
    if (typeof incomingTemp === "number") {
      setTempHistory((prev) => {
        const now = new Date();
        const point = {
          time: now.toLocaleTimeString("zh-CN", { hour12: false }),
          temp: incomingTemp,
        };

        const updated = [...prev, point];

        // 保留最近 3 分钟窗口（45 个数据点）
        const MAX_POINTS = 45;
        return updated.length > MAX_POINTS ? updated.slice(-MAX_POINTS) : updated;
      });
    }
  };

  const loadState = useCallback(async () => {
    const { data, error } = await acClient.fetchState(roomId);
    if (error) {
      setMessage(error);
      return;
    }
    applyResponse(data);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) {
      navigate("/room-control", { replace: true });
      return;
    }
    loadState();
    const interval = window.setInterval(loadState, 4000);
    return () => window.clearInterval(interval);
  }, [loadState, navigate, roomId]);

  const requestServiceIfNeeded = useCallback(
    async (reason: "auto" | "manual") => {
      if (!roomId || !roomState || autoDispatching) {
        return false;
      }
      const currentTemp = typeof roomState.currentTemp === "number" ? roomState.currentTemp : null;
      const desiredTemp =
        typeof roomState.targetTemp === "number" ? roomState.targetTemp : targetInput;
      if (currentTemp === null) {
        return false;
      }
      const tempGap = Math.abs(currentTemp - desiredTemp);
      const needsService = tempGap > 0.2;
      const idle = !roomState.isServing && !roomState.isWaiting;
      if (!needsService || !idle) {
        return false;
      }
      setAutoDispatching(true);
      try {
        const { data, error } = await acClient.powerOn(roomId, {
          mode,
          targetTemp: desiredTemp,
          speed,
        });
        if (error) {
          setMessage(error);
          return false;
        }
        applyResponse(data);
        setMessage(reason === "auto" ? "已根据温差自动发起送风请求。" : "已提交开机请求。");
        return true;
      } finally {
        setAutoDispatching(false);
      }
    },
    [roomId, roomState, autoDispatching, mode, speed, targetInput]
  );

  const handlePowerOn = async () => {
    setIsPoweredOn(true);
    const dispatched = await requestServiceIfNeeded("manual");
    if (!dispatched) {
      setMessage("已开机，当前无需新的送风请求。");
    }
  };

  const handlePowerOff = async () => {
    setIsPoweredOn(false);
    setAutoDispatching(false);
    const { data, error } = await acClient.powerOff(roomId);
    if (error) {
      setMessage(error);
      return;
    }
    applyResponse(data);
    setMessage("已提交关机请求。");
  };

  const updateTargetTemp = (next: number) => {
    setTargetInput(next);
    if (throttleRef.current) {
      window.clearTimeout(throttleRef.current);
    }
    throttleRef.current = window.setTimeout(async () => {
      const { data, error } = await acClient.changeTemp(roomId, next);
      if (error) {
        setMessage(error);
        return;
      }
      applyResponse(data);
      setMessage(null);
    }, 1000);
  };

  const handleTempChange = (offset: number) => {
    updateTargetTemp(targetInput + offset);
  };

  const handleSpeedChange = async (value: string) => {
    setSpeed(value);
    const { data, error } = await acClient.changeSpeed(roomId, value);
    if (error) {
      setMessage(error);
      return;
    }
    applyResponse(data);
    setMessage(null);
  };

  useEffect(() => {
    if (!isPoweredOn) {
      return;
    }
    void requestServiceIfNeeded("auto");
  }, [isPoweredOn, requestServiceIfNeeded]);

  const current = roomState?.currentTemp ?? 25;
  const target = roomState?.targetTemp ?? targetInput;
  const tempDifference =
    typeof roomState?.currentTemp === "number" && typeof roomState?.targetTemp === "number"
      ? Math.abs(roomState.currentTemp - roomState.targetTemp)
      : null;
  const tempsAligned = tempDifference === null ? null : tempDifference <= 0.2;
  const status = (roomState?.isServing ? "SERVING" : roomState?.isWaiting ? "WAITING" : "IDLE") as
    | "SERVING"
    | "WAITING"
    | "IDLE";
  const currentFee = roomState?.currentFee ?? 0;
  const totalFee = roomState?.totalFee ?? 0;

  const toneClasses: Record<string, string> = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    indigo: "border-indigo-100 bg-indigo-50 text-indigo-700",
  };

  const statusCards = [
    {
      key: "power",
      label: "电源",
      value: isPoweredOn ? "已开机" : "关机",
      hint: isPoweredOn ? (autoDispatching ? "正在发起送风请求..." : "满足条件会自动派单") : "点击开机按钮",
      tone: isPoweredOn ? "emerald" : "slate",
    },
    {
      key: "queue",
      label: "排队状态",
      value: roomState?.isWaiting ? "已在请求队列" : "未排队",
      hint: roomState?.isWaiting ? "等待调度中" : "满足条件会自动排队",
      tone: roomState?.isWaiting ? "amber" : "slate",
    },
    {
      key: "serving",
      label: "送风状态",
      value: roomState?.isServing ? "正在服务" : "未服务",
      hint: roomState?.isServing ? "当前送风中" : "等待调度或排队",
      tone: roomState?.isServing ? "indigo" : "slate",
    },
    {
      key: "temp",
      label: "温差监测",
      value:
        tempDifference === null
          ? "暂无数据"
          : tempsAligned
          ? "已达设定"
          : `${tempDifference.toFixed(1)}℃ 差值`,
      hint:
        tempDifference === null
          ? "等待房间数据"
          : tempsAligned
          ? "无需派单"
          : "温差>0.2℃ 将触发送风",
      tone: tempsAligned === false ? "amber" : "emerald",
    },
  ];

  return (
    <div className="space-y-8">
      <RoomHeader roomId={roomId} status={status} mode={mode} />

      {message && (
        <div className="rounded-2xl border border-yellow-100 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 shadow-sm">
          提示：{message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statusCards.map((card) => (
          <div
            key={card.key}
            className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClasses[card.tone] ?? toneClasses.slate}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="text-lg font-semibold text-slate-900">{card.value}</p>
            <p className="text-xs text-slate-600">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 左侧 */}
        <div className="space-y-6 rounded-2xl border border-white/80 bg-white p-6 shadow-sm">
          <TempGauge current={current} target={target} />

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium shadow-sm transition hover:shadow hover:scale-[1.01]"
              onClick={() => handleTempChange(-1)}
            >
              -1℃
            </button>
            <button
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium shadow-sm transition hover:shadow hover:scale-[1.01]"
              onClick={() => handleTempChange(1)}
            >
              +1℃
            </button>
            <input
              type="number"
              className="w-24 rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm"
              value={targetInput}
              onChange={(e) => updateTargetTemp(Number(e.target.value))}
            />
          </div>

          {/* 状态标签 */}
          <div
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
              status === "SERVING"
                ? "bg-emerald-50 text-emerald-600"
                : status === "WAITING"
                ? "bg-amber-50 text-amber-600"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {status}
          </div>

          {/* 温度变化曲线 */}
          <div className="mt-4 h-64 w-full rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-600">
              温度变化曲线（最近 3 分钟）
            </h4>
            <TempHistoryChart points={tempHistory} />
          </div>
        </div>

        {/* 右侧 */}
        <div className="space-y-4 rounded-2xl border border-white/80 bg-white p-6 shadow-sm">
          <SpeedSelector value={speed} onChange={handleSpeedChange} />
          <FeePanel currentFee={currentFee} totalFee={totalFee} />

          <div className="flex gap-3">
            <button
              className="rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:shadow-lg hover:scale-[1.01]"
              onClick={handlePowerOn}
            >
              开机
            </button>
            <button
              className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-600 shadow-sm transition hover:shadow-lg hover:scale-[1.01]"
              onClick={handlePowerOff}
            >
              关机
            </button>
          </div>

          <div>
            <button
              className="mt-2 w-full rounded-2xl bg-brand-accent px-6 py-4 text-sm font-semibold text-white shadow-sm transition hover:shadow-lg hover:scale-[1.01]"
              onClick={async () => {
                const { data, error } = await frontdeskClient.checkOut(roomId);
                if (error) {
                  setMessage(error);
                  return;
                }
                setCheckoutResult(data ?? null);
                setShowCheckout(true);
              }}
            >
              办理退房
            </button>
          </div>

        </div>
      </div>

      {/* 退房弹窗 */}
      {showCheckout && checkoutResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-2xl font-semibold">
                退房结算 - 房间 {checkoutResult.roomId}
              </h3>
              <button
                className="rounded-full px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
                onClick={() => setShowCheckout(false)}
              >
                关闭
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="mb-2 text-lg font-semibold">住宿账单</h4>
                <p>账单号：{checkoutResult.accommodationBill.billId}</p>
                <p>
                  入住晚数：{checkoutResult.accommodationBill.nights} × 每晚单价{" "}
                  {checkoutResult.accommodationBill.ratePerNight} = ¥
                  {checkoutResult.accommodationBill.roomFee.toFixed(2)}
                </p>
                <p>押金：¥{checkoutResult.accommodationBill.deposit.toFixed(2)}</p>
              </section>

              {checkoutResult.acBill && (
                <section className="rounded-xl border border-slate-200 p-4">
                  <h4 className="mb-2 text-lg font-semibold">空调账单</h4>
                  <p>账单号：{checkoutResult.acBill.billId}</p>
                  <p>
                    时段：{checkoutResult.acBill.periodStart} →{" "}
                    {checkoutResult.acBill.periodEnd}
                  </p>
                  <p>空调费用合计：¥{checkoutResult.acBill.totalFee.toFixed(2)}</p>
                </section>
              )}

              <section className="rounded-xl border border-slate-200 p-4">
                <h4 className="mb-2 text-lg font-semibold">空调详单</h4>
                <details className="rounded border border-slate-100 p-2">
                  <summary className="cursor-pointer select-none text-slate-600">
                    展开/收起详单
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {checkoutResult.detailRecords.map((rec) => (
                      <li
                        key={rec.recordId}
                        className="rounded border border-slate-100 p-2"
                      >
                        <p>
                          {rec.speed} · {rec.startedAt} → {rec.endedAt ?? "-"}
                        </p>
                        <p>
                          费率：{rec.ratePerMin}/min · 费用：
                          ¥{rec.feeValue.toFixed(2)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              </section>

              <div className="rounded-xl border border-slate-200 p-4 text-lg font-semibold">
                应付合计：¥{checkoutResult.totalDue.toFixed(2)}
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                className="flex-1 rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:shadow-lg hover:scale-[1.01]"
                onClick={() => navigate("/room-control")}
              >
                完成退房，返回选房页
              </button>
              <button
                className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-600"
                onClick={() => setShowCheckout(false)}
              >
                留在此页
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
