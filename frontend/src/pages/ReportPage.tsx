import { useEffect, useMemo, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, ArcElement, BarElement, type TooltipItem } from "chart.js";
import { Line, Pie, Bar } from "react-chartjs-2";
import { reportClient, type ReportResponse } from "../api/reportClient";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, ArcElement, BarElement);

const toInputValue = (date: Date) => date.toISOString().slice(0, 16);
const currencyFormatter = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export function ReportPage() {
  const now = new Date();
  const [fromValue, setFromValue] = useState(toInputValue(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
  const [toValue, setToValue] = useState(toInputValue(now));
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [trendMode, setTrendMode] = useState<"hour" | "day">("hour");
  const [page, setPage] = useState(0);
  const pageSize = 6;

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    const fromIso = new Date(fromValue).toISOString();
    const toIso = new Date(toValue).toISOString();
    const { data, error } = await reportClient.fetchReport(fromIso, toIso);
    if (error) {
      setError(error);
      setReport(null);
    } else {
      setReport(data ?? null);
      setLastUpdated(new Date());
      setPage(0);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roomsSorted = useMemo(() => {
    if (!report) return [];
    return [...report.rooms].sort((a, b) => b.fee - a.fee);
  }, [report]);
  const totalPages = Math.max(1, Math.ceil(roomsSorted.length / pageSize));
  const pagedRooms = roomsSorted.slice(page * pageSize, page * pageSize + pageSize);

  const trendData = useMemo(() => {
    if (!report) return [];
    if (trendMode === "hour") return report.trend;
    const dayMap = new Map<string, { fee: number; kwh: number }>();
    report.trend.forEach((point) => {
      const day = point.time.slice(0, 10);
      const bucket = dayMap.get(day) ?? { fee: 0, kwh: 0 };
      bucket.fee += point.fee;
      bucket.kwh += point.kwh;
      dayMap.set(day, bucket);
    });
    return Array.from(dayMap.entries())
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([day, value]) => ({ time: day, fee: value.fee, kwh: value.kwh }));
  }, [report, trendMode]);

  const topRooms = roomsSorted.slice(0, 10);
  const speedRate = report?.speedRate ?? { high: 0, mid: 0, low: 0 };

  const summaryCards = report
    ? [
        {
          title: "总收入",
          value: currencyFormatter.format(report.summary.totalRevenue),
          subtitle: "统计区间内累计收入",
          icon: "🧾",
        },
        {
          title: "空调收入",
          value: currencyFormatter.format(report.summary.acRevenue),
          subtitle: "空调费用按详单聚合",
          icon: "❄️",
        },
        {
          title: "房费收入",
          value: currencyFormatter.format(report.summary.roomRevenue),
          subtitle: "住宿账单累积",
          icon: "🏨",
        },
        {
          title: "总耗电量",
          value: `${numberFormatter.format(report.summary.totalKwh)} kWh`,
          subtitle: "详单能耗换算",
          icon: "🔌",
        },
      ]
    : [];

  const kpiCards = report
    ? [
        { label: "平均单房耗电", value: `${numberFormatter.format(report.kpi.avgKwh)} kWh/room` },
        { label: "平均单房空调费", value: currencyFormatter.format(report.kpi.avgFee) },
        { label: "峰值时段", value: report.kpi.peakHour ?? "--" },
        { label: "高风请求占比", value: `${(report.kpi.highRate * 100).toFixed(1)}%` },
        { label: "平均会话时长", value: `${numberFormatter.format(report.kpi.avgSession)} min` },
      ]
    : [];

  const lineChartData = {
    labels: trendData.map((item) => item.time),
    datasets: [
      {
        label: "费用 (¥)",
        data: trendData.map((item) => item.fee),
        borderColor: "#6366f1",
        backgroundColor: "rgba(99,102,241,0.15)",
        fill: true,
        tension: 0.35,
        yAxisID: "y",
      },
      {
        label: "耗电量 (kWh)",
        data: trendData.map((item) => item.kwh),
        borderColor: "#14b8a6",
        backgroundColor: "rgba(20,184,166,0.15)",
        fill: true,
        tension: 0.35,
        yAxisID: "y1",
      },
    ],
  };

  const pieChartData = {
    labels: ["高风", "中风", "低风"],
    datasets: [
      {
        data: [speedRate.high, speedRate.mid, speedRate.low],
        backgroundColor: ["#ef4444", "#3b82f6", "#22c55e"],
        hoverOffset: 6,
      },
    ],
  };

  const roomBarData = {
    labels: topRooms.map((room) => room.roomId),
    datasets: [
      {
        label: "空调费用 (¥)",
        data: topRooms.map((room) => room.fee),
        backgroundColor: "rgba(99,102,241,0.8)",
        borderRadius: 8,
      },
    ],
  };

  const hourlyStackedData = {
    labels: report?.hourlySpeed.map((item) => item.hour) ?? [],
    datasets: [
      {
        label: "高风",
        data: report?.hourlySpeed.map((item) => item.high) ?? [],
        backgroundColor: "rgba(239,68,68,0.85)",
        stack: "speed",
      },
      {
        label: "中风",
        data: report?.hourlySpeed.map((item) => item.mid) ?? [],
        backgroundColor: "rgba(59,130,246,0.85)",
        stack: "speed",
      },
      {
        label: "低风",
        data: report?.hourlySpeed.map((item) => item.low) ?? [],
        backgroundColor: "rgba(34,197,94,0.85)",
        stack: "speed",
      },
    ],
  };

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Hotel AC Dashboard</p>
        <h2 className="text-4xl font-semibold">空调统计报表</h2>
        <p className="text-sm text-slate-500">按时间区间洞察收入、能耗、风速结构与房间表现。</p>
      </header>

      <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-600">
            开始时间
            <input className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2" type="datetime-local" value={fromValue} onChange={(e) => setFromValue(e.target.value)} />
          </label>
          <label className="text-sm text-slate-600">
            结束时间
            <input className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2" type="datetime-local" value={toValue} onChange={(e) => setToValue(e.target.value)} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">最后更新：{lastUpdated ? lastUpdated.toLocaleString() : "--"}</div>
          <button
            className="inline-flex items-center rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            onClick={loadReport}
            disabled={loading}
          >
            {loading ? "刷新中..." : "刷新报表"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">{error}</div>}

      {report ? (
        <div className="space-y-8">
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <article key={card.title} className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">{card.title}</p>
                  <span className="text-lg">{card.icon}</span>
                </div>
                <p className="mt-3 text-3xl font-semibold text-slate-900">{card.value}</p>
                <p className="text-xs text-slate-500">{card.subtitle}</p>
              </article>
            ))}
          </div>

          {/* Trend + pie */}
          <div className="grid gap-6 lg:grid-cols-3">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold">空调运行趋势</h3>
                  <p className="text-sm text-slate-500">费用与能耗走势</p>
                </div>
                <div className="rounded-full border border-slate-200 p-1 text-xs">
                  {["hour", "day"].map((mode) => (
                    <button
                      key={mode}
                      className={`rounded-full px-3 py-1 font-medium transition ${trendMode === mode ? "bg-indigo-500 text-white" : "text-slate-500"}`}
                      onClick={() => setTrendMode(mode as "hour" | "day")}
                      type="button"
                    >
                      {mode === "hour" ? "按小时" : "按天"}
                    </button>
                  ))}
                </div>
              </div>
              {trendData.length > 0 ? (
                <div className="mt-4">
                  <Line
                    data={lineChartData}
                    options={{
                      responsive: true,
                      interaction: { mode: "index", intersect: false },
                      stacked: false,
                      plugins: { legend: { position: "bottom" } },
                      scales: {
                        y: { title: { display: true, text: "费用 (¥)" } },
                        y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "耗电 (kWh)" } },
                      },
                    }}
                  />
                </div>
              ) : (
                <p className="mt-6 text-center text-sm text-slate-500">暂无趋势数据</p>
              )}
            </article>
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-xl font-semibold">风速占比</h3>
              <p className="text-sm text-slate-500">高/中/低风时长占比</p>
              {speedRate.high + speedRate.mid + speedRate.low > 0 ? (
                <div className="mt-4">
                  <Pie
                    data={pieChartData}
                    options={{
                      plugins: {
                        legend: { position: "bottom" },
                        tooltip: {
                          callbacks: {
                            label: (ctx: TooltipItem<"pie">) => {
                              const value = ctx.parsed as number;
                              return `${ctx.label}: ${(value * 100).toFixed(1)}%`;
                            },
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <p className="mt-6 text-center text-sm text-slate-500">暂无风速数据</p>
              )}
            </article>
          </div>

          {/* Room breakdown + bar chart */}
          <div className="grid gap-6 lg:grid-cols-3">
            <article className="rounded-3xl border border-slate-200 bg-white p-0 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <div>
                  <h3 className="text-xl font-semibold">房间表现</h3>
                  <p className="text-sm text-slate-500">按空调费用降序 · 页 {page + 1}/{totalPages}</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <button className="rounded-full border border-slate-200 px-3 py-1 disabled:opacity-40" type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(p - 1, 0))}>
                    上一页
                  </button>
                  <button className="rounded-full border border-slate-200 px-3 py-1 disabled:opacity-40" type="button" disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(p + 1, totalPages - 1))}>
                    下一页
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">房间号</th>
                      <th className="px-4 py-3">使用时长 (min)</th>
                      <th className="px-4 py-3">高风次数</th>
                      <th className="px-4 py-3">中风次数</th>
                      <th className="px-4 py-3">低风次数</th>
                      <th className="px-4 py-3">耗电量 (kWh)</th>
                      <th className="px-4 py-3">空调费用 (¥)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {pagedRooms.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-center text-slate-500" colSpan={7}>
                          暂无房间数据
                        </td>
                      </tr>
                    )}
                    {pagedRooms.map((room) => (
                      <tr key={room.roomId} className="transition hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">#{room.roomId}</td>
                        <td className="px-4 py-3">{numberFormatter.format(room.minutes)}</td>
                        <td className="px-4 py-3">{room.highCount}</td>
                        <td className="px-4 py-3">{room.midCount}</td>
                        <td className="px-4 py-3">{room.lowCount}</td>
                        <td className="px-4 py-3">{numberFormatter.format(room.kwh)}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
                            {currencyFormatter.format(room.fee)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-xl font-semibold">房间费用 TOP10</h3>
              {topRooms.length > 0 ? (
                <div className="mt-4">
                  <Bar
                    data={roomBarData}
                    options={{
                      indexAxis: "y" as const,
                      plugins: { legend: { display: false } },
                      scales: { x: { beginAtZero: true } },
                    }}
                  />
                </div>
              ) : (
                <p className="mt-6 text-center text-sm text-slate-500">暂无房间排行</p>
              )}
            </article>
          </div>

          {/* Hourly stacked */}
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-xl font-semibold">使用结构分析</h3>
            <p className="text-sm text-slate-500">按小时堆叠高/中/低风分钟数</p>
            {report.hourlySpeed.length > 0 ? (
              <div className="mt-4">
                <Bar
                  data={hourlyStackedData}
                  options={{
                    responsive: true,
                    plugins: { legend: { position: "bottom" } },
                    scales: {
                      x: { stacked: true },
                      y: { stacked: true, title: { display: true, text: "分钟" } },
                    },
                  }}
                />
              </div>
            ) : (
              <p className="mt-6 text-center text-sm text-slate-500">暂无堆叠数据</p>
            )}
          </article>

          {/* KPI cards */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {kpiCards.map((kpi) => (
              <article key={kpi.label} className="rounded-2xl border border-slate-100 bg-white/90 p-4 text-sm shadow-sm">
                <p className="text-slate-500">{kpi.label}</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{kpi.value}</p>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-slate-500">
          暂无报表数据，请调整时间范围后刷新。
        </div>
      )}
    </section>
  );
}
