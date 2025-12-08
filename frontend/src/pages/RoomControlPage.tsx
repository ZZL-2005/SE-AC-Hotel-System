import { useCallback, useEffect, useRef, useState, useId } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FeePanel, RoomHeader, SpeedSelector, TempGauge } from "../components";
import { acClient, type RoomStateResponse } from "../api/acClient";
import { frontdeskClient, type CheckOutResponse } from "../api/frontdeskClient";

// Apple 风格温度历史折线图
type TempPoint = { time: string; temp: number };

function TempHistoryChart({ points }: { points: TempPoint[] }) {
  const gradientId = useId();
  const areaId = `${gradientId}-area`;

  if (points.length < 2) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-[#86868b]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full bg-[#f5f5f7] flex items-center justify-center">
            <span className="text-xl">📈</span>
          </div>
          <p className="text-xs">温度数据收集中...</p>
        </div>
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
  const height = 160;
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
  const latestY = height - ((latest.temp - yMin) / range) * height;

  const gridLines = [0, 0.5, 1].map((p) => ({
    y: p * height,
    val: yMax - p * range,
  }));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d1d1f" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#1d1d1f" stopOpacity="0" />
        </linearGradient>
        <filter id={areaId}>
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#1d1d1f" floodOpacity="0.05" />
        </filter>
      </defs>

      {/* 网格线 */}
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={0} y1={g.y} x2={width} y2={g.y} stroke="#e8e8ed" strokeWidth="1" />
          <text x={4} y={g.y + (i === 0 ? 14 : -6)} fontSize="10" fill="#86868b">
            {g.val.toFixed(1)}°
          </text>
        </g>
      ))}

      {/* 区域填充 */}
      <path d={areaPath} fill={`url(#${gradientId})`} filter={`url(#${areaId})`} />

      {/* 折线 */}
      <path
        d={linePath}
        fill="none"
        stroke="#1d1d1f"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 数据点 */}
      {points.map((point, index) => {
        const x = index * stepX;
        const y = height - ((point.temp - yMin) / range) * height;
        const isLast = index === points.length - 1;

        return (
          <g key={index}>
            {isLast && (
              <>
                <circle cx={x} cy={y} r={5} fill="#1d1d1f" />
                <circle cx={x} cy={y} r={8} fill="none" stroke="#1d1d1f" strokeWidth={1} opacity={0.3}>
                  <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
                </circle>
                <rect x={x - 24} y={y - 28} width={48} height={20} rx={6} fill="#1d1d1f" />
                <text x={x} y={y - 14} fontSize="10" fill="white" textAnchor="middle" fontWeight="500">
                  {point.temp.toFixed(1)}℃
                </text>
              </>
            )}
            {!isLast && <circle cx={x} cy={y} r={2} fill="#86868b" />}
          </g>
        );
      })}
    </svg>
  );
}

export function RoomControlPage() {
  const navigate = useNavigate();
  const params = useParams();
  const roomId = params.roomId ?? "";

  const [roomState, setRoomState] = useState<RoomStateResponse | null>(null);
  const [speed, setSpeed] = useState("MID");
  const [targetInput, setTargetInput] = useState(24);
  const [message, setMessage] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckOutResponse | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [isPoweredOn, setIsPoweredOn] = useState(false);
  const [autoDispatching, setAutoDispatching] = useState(false);
  const throttleRef = useRef<number | null>(null);
  const [autoRestartThreshold, setAutoRestartThreshold] = useState(0.2);

  // 本地待提交的调节值
  const [pendingTemp, setPendingTemp] = useState(24);
  const [pendingSpeed, setPendingSpeed] = useState("MID");
  const [tempDirty, setTempDirty] = useState(false);
  const [speedDirty, setSpeedDirty] = useState(false);

  // 新增：温度历史记录
  const [tempHistory, setTempHistory] = useState<
    { time: string; temp: number }[]
  >([]);

  const applyResponse = (state?: RoomStateResponse | null) => {
    if (!state) return;

    setRoomState(state);

    if (state.speed) {
      setSpeed(state.speed);
      setPendingSpeed(state.speed);
    }
    if (typeof state.targetTemp === "number") {
      setTargetInput(state.targetTemp);
      setPendingTemp(state.targetTemp);
    }
    if (state.isServing || state.isWaiting) {
      setIsPoweredOn(true);
    }
    if (typeof state.autoRestartThreshold === "number") {
      setAutoRestartThreshold(state.autoRestartThreshold);
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
      const needsService = tempGap > autoRestartThreshold;
      const idle = !roomState.isServing && !roomState.isWaiting;
      if (!needsService || !idle) {
        return false;
      }
      setAutoDispatching(true);
      try {
        const { data, error } = await acClient.powerOn(roomId);
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
    [roomId, roomState, autoDispatching, targetInput, autoRestartThreshold]
  );

  // 切换电源开关
  const handleTogglePower = async () => {
    if (isPoweredOn) {
      // 关机
      setIsPoweredOn(false);
      setAutoDispatching(false);
      const { data, error } = await acClient.powerOff(roomId);
      if (error) {
        setMessage(error);
        setIsPoweredOn(true); // 回滚
        return;
      }
      applyResponse(data);
      setMessage("已关机。");
    } else {
      // 开机
      setIsPoweredOn(true);
      const dispatched = await requestServiceIfNeeded("manual");
      if (!dispatched) {
        setMessage("已开机，当前无需新的送风请求。");
      }
    }
  };

  // 本地调节温度（不立即发送）
  const handleLocalTempChange = (offset: number) => {
    if (!isPoweredOn) return;
    const next = pendingTemp + offset;
    setPendingTemp(next);
    setTempDirty(next !== targetInput);
  };

  const handleLocalTempInput = (val: number) => {
    if (!isPoweredOn) return;
    setPendingTemp(val);
    setTempDirty(val !== targetInput);
  };

  // 本地调节风速（不立即发送）
  const handleLocalSpeedChange = (value: string) => {
    if (!isPoweredOn) return;
    setPendingSpeed(value);
    setSpeedDirty(value !== speed);
  };

  // 提交温度调节
  const handleApplyTemp = async () => {
    if (!tempDirty) return;
    const { data, error } = await acClient.changeTemp(roomId, pendingTemp);
    if (error) {
      setMessage(error);
      return;
    }
    applyResponse(data);
    setTempDirty(false);
    setMessage("温度调节已应用。");
  };

  // 提交风速调节
  const handleApplySpeed = async () => {
    if (!speedDirty) return;
    const { data, error } = await acClient.changeSpeed(roomId, pendingSpeed);
    if (error) {
      setMessage(error);
      return;
    }
    applyResponse(data);
    setSpeedDirty(false);
    setMessage("风速调节已应用。");
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

  const statusItems = [
    {
      key: "power",
      label: "电源",
      value: isPoweredOn ? "运行中" : "已关闭",
      active: isPoweredOn,
    },
    {
      key: "queue",
      label: "排队",
      value: roomState?.isWaiting ? "等待中" : "—",
      active: !!roomState?.isWaiting,
    },
    {
      key: "serving",
      label: "服务",
      value: roomState?.isServing ? "送风中" : "待机",
      active: !!roomState?.isServing,
    },
    {
      key: "temp",
      label: "温差",
      value: tempDifference === null ? "—" : tempsAligned ? "达标" : `${tempDifference.toFixed(1)}°`,
      active: tempsAligned === false,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-12">
      {/* 页面头部 - Apple 风格 */}
      <header className="text-center space-y-4">
        <h1 className="text-[40px] font-semibold tracking-tight text-[#1d1d1f]">
          房间 {roomId}
        </h1>
        <div className="flex items-center justify-center gap-4">
          <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${
            status === "SERVING"
              ? "bg-[#1d1d1f] text-white"
              : status === "WAITING"
              ? "bg-[#f5f5f7] text-[#1d1d1f]"
              : "bg-[#f5f5f7] text-[#86868b]"
          }`}>
            <span className={`h-2 w-2 rounded-full ${
              status === "SERVING" ? "bg-white animate-pulse" 
              : status === "WAITING" ? "bg-[#ff9500]" 
              : "bg-[#86868b]"
            }`} />
            {status === "SERVING" ? "送风服务中" : status === "WAITING" ? "排队等待" : "待机"}
          </span>
        </div>
      </header>

      {message && (
        <div className="glass rounded-2xl px-6 py-4 text-sm text-[#1d1d1f] flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-[#f5f5f7] flex items-center justify-center">💡</span>
          {message}
        </div>
      )}

      {/* 状态指示器 - 极简设计 */}
      <div className="flex items-center justify-center gap-8">
        {statusItems.map((item) => (
          <div key={item.key} className="text-center">
            <p className="text-xs text-[#86868b] mb-1">{item.label}</p>
            <p className={`text-lg font-semibold ${item.active ? "text-[#1d1d1f]" : "text-[#86868b]"}`}>
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* 左侧控制面板 */}
        <div className="glass rounded-3xl p-8 space-y-8">
          <div className="text-center">
            <h3 className="text-xl font-semibold text-[#1d1d1f]">温度控制</h3>
            <p className="text-sm text-[#86868b] mt-1">实时监控与调节</p>
          </div>

          <TempGauge current={current} target={target} />

          {/* 温度调节按钮 - Apple 风格 */}
          <div className={`transition-opacity ${!isPoweredOn ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-center gap-5">
              <button
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f5f7] text-xl font-medium text-[#1d1d1f] transition-all hover:bg-[#e8e8ed] active:scale-95 disabled:cursor-not-allowed"
                onClick={() => handleLocalTempChange(-1)}
                disabled={!isPoweredOn}
              >
                −
              </button>
              
              <div className="relative">
                <input
                  type="number"
                  className="w-24 rounded-xl bg-[#f5f5f7] px-4 py-3 text-center text-2xl font-semibold text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all disabled:cursor-not-allowed"
                  value={pendingTemp}
                  onChange={(e) => handleLocalTempInput(Number(e.target.value))}
                  disabled={!isPoweredOn}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#86868b]">°C</span>
              </div>
              
              <button
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f5f7] text-xl font-medium text-[#1d1d1f] transition-all hover:bg-[#e8e8ed] active:scale-95 disabled:cursor-not-allowed"
                onClick={() => handleLocalTempChange(1)}
                disabled={!isPoweredOn}
              >
                +
              </button>
            </div>

            {/* 应用温度按钮 */}
            <button
              onClick={handleApplyTemp}
              disabled={!tempDirty || !isPoweredOn}
              className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-medium transition-all active:scale-[0.98] ${
                tempDirty && isPoweredOn
                  ? 'bg-[#0071e3] text-white hover:bg-[#0077ed]'
                  : 'bg-[#e8e8ed] text-[#86868b] cursor-not-allowed'
              }`}
            >
              {tempDirty ? `应用温度 (${pendingTemp}°C)` : '调节温度'}
            </button>
          </div>

          {/* 温度历史曲线 */}
          <div className="rounded-2xl bg-[#f5f5f7] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-medium text-[#1d1d1f] text-sm">温度变化</h4>
                <p className="text-xs text-[#86868b]">最近 3 分钟</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-[#86868b]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#34c759] animate-pulse" />
                实时
              </span>
            </div>
            <div className="h-40">
              <TempHistoryChart points={tempHistory} />
            </div>
          </div>
        </div>

        {/* 右侧设置面板 */}
        <div className="glass rounded-3xl p-8 space-y-8">
          <div className="text-center">
            <h3 className="text-xl font-semibold text-[#1d1d1f]">空调设置</h3>
            <p className="text-sm text-[#86868b] mt-1">风速与费用</p>
          </div>

          {/* 电源开关 - iOS 风格 */}
          <div className="rounded-2xl bg-[#f5f5f7] p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#1d1d1f]">电源开关</p>
                <p className="text-xs text-[#86868b] mt-0.5">
                  {isPoweredOn ? '空调运行中' : '点击开启空调'}
                </p>
              </div>
              <button
                onClick={handleTogglePower}
                className={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                  isPoweredOn ? 'bg-[#34c759]' : 'bg-[#e8e8ed]'
                }`}
                role="switch"
                aria-checked={isPoweredOn}
              >
                <span
                  className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-300 ${
                    isPoweredOn ? 'left-7' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </div>

          <SpeedSelector value={pendingSpeed} onChange={handleLocalSpeedChange} disabled={!isPoweredOn} />
          
          {/* 应用风速按钮 */}
          <button
            onClick={handleApplySpeed}
            disabled={!speedDirty || !isPoweredOn}
            className={`w-full rounded-xl px-4 py-3 text-sm font-medium transition-all active:scale-[0.98] ${
              speedDirty && isPoweredOn
                ? 'bg-[#0071e3] text-white hover:bg-[#0077ed]'
                : 'bg-[#e8e8ed] text-[#86868b] cursor-not-allowed'
            }`}
          >
            {speedDirty ? `应用风速 (${pendingSpeed === 'LOW' ? '低档' : pendingSpeed === 'MID' ? '中档' : '高档'})` : '调节风速'}
          </button>

          <FeePanel currentFee={currentFee} totalFee={totalFee} />
        </div>
      </div>

      {/* 退房弹窗 - Apple 风格 */}
      {showCheckout && checkoutResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xl p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto glass rounded-3xl p-8 shadow-2xl">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-[#f5f5f7] flex items-center justify-center text-3xl">
                🧾
              </div>
              <h3 className="text-2xl font-semibold text-[#1d1d1f]">退房结算</h3>
              <p className="mt-1 text-sm text-[#86868b]">房间 {checkoutResult.roomId}</p>
            </div>

            <div className="space-y-4">
              {/* 住宿账单 */}
              <div className="rounded-2xl bg-[#f5f5f7] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-lg">🏨</span>
                  <div>
                    <h4 className="font-medium text-[#1d1d1f]">住宿账单</h4>
                    <p className="text-xs text-[#86868b]">#{checkoutResult.accommodationBill.billId}</p>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#86868b]">入住晚数</span>
                    <span className="text-[#1d1d1f]">{checkoutResult.accommodationBill.nights} 晚 × ¥{checkoutResult.accommodationBill.ratePerNight}/晚</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#86868b]">房费小计</span>
                    <span className="font-medium text-[#1d1d1f]">¥{checkoutResult.accommodationBill.roomFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#86868b]">押金</span>
                    <span className="text-[#1d1d1f]">¥{checkoutResult.accommodationBill.deposit.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* 空调账单 */}
              {checkoutResult.acBill && (
                <div className="rounded-2xl bg-[#f5f5f7] p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-lg">❄️</span>
                    <div>
                      <h4 className="font-medium text-[#1d1d1f]">空调账单</h4>
                      <p className="text-xs text-[#86868b]">#{checkoutResult.acBill.billId}</p>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#86868b]">计费时段</span>
                      <span className="text-[#1d1d1f]">{checkoutResult.acBill.periodStart} → {checkoutResult.acBill.periodEnd}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#86868b]">费用合计</span>
                      <span className="font-medium text-[#1d1d1f]">¥{checkoutResult.acBill.totalFee.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 空调详单 */}
              <details className="rounded-2xl bg-[#f5f5f7] p-5 group">
                <summary className="flex items-center justify-between cursor-pointer select-none">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-lg">📋</span>
                    <div>
                      <h4 className="font-medium text-[#1d1d1f]">使用详单</h4>
                      <p className="text-xs text-[#86868b]">共 {checkoutResult.detailRecords.length} 条记录</p>
                    </div>
                  </div>
                  <span className="text-[#86868b] group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <ul className="mt-4 space-y-2 max-h-48 overflow-auto">
                  {checkoutResult.detailRecords.map((rec) => (
                    <li key={rec.recordId} className="rounded-xl bg-white p-3 text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="text-[#1d1d1f]">{rec.speed} 档位</span>
                        <span className="font-medium text-[#1d1d1f]">¥{rec.feeValue.toFixed(2)}</span>
                      </div>
                      <div className="text-[#86868b]">
                        {rec.startedAt} → {rec.endedAt ?? "进行中"} · 费率 ¥{rec.ratePerMin}/min
                      </div>
                    </li>
                  ))}
                </ul>
              </details>

              {/* 应付总计 */}
              <div className="rounded-2xl bg-[#1d1d1f] p-5 text-white">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">应付总计</span>
                  <span className="text-3xl font-semibold">¥{checkoutResult.totalDue.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                className="rounded-xl bg-[#0071e3] px-5 py-4 text-sm font-medium text-white transition-all hover:bg-[#0077ed] active:scale-[0.98]"
                onClick={() => navigate("/room-control")}
              >
                完成退房
              </button>
              <button
                className="rounded-xl bg-[#f5f5f7] px-5 py-4 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#e8e8ed] active:scale-[0.98]"
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
