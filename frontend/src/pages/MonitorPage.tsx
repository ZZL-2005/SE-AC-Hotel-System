import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { RoomStatusGrid } from "../components";
import { monitorClient } from "../api/monitorClient";
import type { RoomStatus } from "../types/rooms";

// 事件日志类型
interface SystemEvent {
  id: string;
  time: Date;
  type: "online" | "offline" | "target_reached" | "warning" | "info" | "start";
  roomId?: string;
  message: string;
}

export function MonitorPage() {
  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomStatus | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null); // null = 显示所有楼层
  const [highlightedRoomId, setHighlightedRoomId] = useState<string | null>(null);
  const [showActiveOnly, setShowActiveOnly] = useState(false); // 仅显示活跃房间
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]); // 系统事件日志
  const prevRoomsRef = useRef<RoomStatus[]>([]); // 用于对比状态变化
  const [tempHistory, setTempHistory] = useState<Map<number, Array<{ time: Date; temp: number }>>>(new Map()); // 楼层温度历史数据

  // 时间更新
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await monitorClient.fetchRooms();
      if (cancelled) return;
      if (error) {
        setError(error);
        return;
      }
      const newRooms = data?.rooms ?? [];
      setRooms(newRooms);
      setLastUpdated(new Date());
      setError(null);
      
      // 累积温度历史数据（按楼层分组）
      if (newRooms.length > 0) {
        const now = new Date();
        setTempHistory(prev => {
          const updated = new Map(prev);
          
          // 按楼层分组计算平均温度
          const floorTemps = new Map<number, { sum: number; count: number }>();
          newRooms.forEach(room => {
            const roomNum = parseInt(room.roomId);
            const floor = Math.ceil(roomNum / 10);
            if (floor >= 1 && floor <= 10) {
              const current = floorTemps.get(floor) || { sum: 0, count: 0 };
              floorTemps.set(floor, {
                sum: current.sum + (room.currentTemp ?? 25),
                count: current.count + 1
              });
            }
          });
          
          // 更新每个楼层的历史数据
          floorTemps.forEach((stats, floor) => {
            const avgTemp = stats.count > 0 ? stats.sum / stats.count : 25;
            const history = updated.get(floor) || [];
            const newPoint = { time: new Date(now), temp: avgTemp };
            
            // 保留最近24小时的数据
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const filtered = history.filter(h => h.time > oneDayAgo);
            
            // 添加新点
            filtered.push(newPoint);
            
            // 按时间排序
            filtered.sort((a, b) => a.time.getTime() - b.time.getTime());
            
            // 为了减少数据量，每5分钟只保留一个点（但保留最新的点）
            const sampled: Array<{ time: Date; temp: number }> = [];
            const fiveMinutes = 5 * 60 * 1000;
            let lastSampledTime: Date | null = null;
            
            for (const point of filtered) {
              if (!lastSampledTime || point.time.getTime() - lastSampledTime.getTime() >= fiveMinutes) {
                sampled.push(point);
                lastSampledTime = point.time;
              }
            }
            
            // 确保最新的点总是被包含
            if (sampled.length === 0 || sampled[sampled.length - 1].time.getTime() !== newPoint.time.getTime()) {
              sampled.push(newPoint);
            }
            
            updated.set(floor, sampled);
          });
          
          return updated;
        });
      }
    };
    load();
    const interval = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // 事件日志生成：检测房间状态变化
  useEffect(() => {
    if (rooms.length === 0) return;
    
    const prevRooms = prevRoomsRef.current;
    const newEvents: SystemEvent[] = [];
    const now = new Date();
    
    // 创建前一次状态的映射
    const prevMap = new Map<string, RoomStatus>();
    prevRooms.forEach(r => prevMap.set(r.roomId, r));
    
    rooms.forEach(room => {
      const prev = prevMap.get(room.roomId);
      
      // 房间上线（从非服务变为服务中）
      if (room.isServing && (!prev || !prev.isServing)) {
        newEvents.push({
          id: `${now.getTime()}-${room.roomId}-online`,
          time: now,
          type: "online",
          roomId: room.roomId,
          message: `房间 ${room.roomId} 开始服务`,
        });
      }
      
      // 房间进入等待队列
      if (room.isWaiting && (!prev || !prev.isWaiting)) {
        newEvents.push({
          id: `${now.getTime()}-${room.roomId}-waiting`,
          time: now,
          type: "info",
          roomId: room.roomId,
          message: `房间 ${room.roomId} 进入等待队列`,
        });
      }
      
      // 房间离线（从服务中变为非服务）
      if (!room.isServing && prev?.isServing) {
        // 检查是否达到目标温度
        const tempDiff = Math.abs(room.currentTemp - room.targetTemp);
        if (tempDiff < 0.5) {
          newEvents.push({
            id: `${now.getTime()}-${room.roomId}-target`,
            time: now,
            type: "target_reached",
            roomId: room.roomId,
            message: `房间 ${room.roomId} 达到目标温度，进入待机`,
          });
        } else {
          newEvents.push({
            id: `${now.getTime()}-${room.roomId}-offline`,
            time: now,
            type: "offline",
            roomId: room.roomId,
            message: `房间 ${room.roomId} 服务结束`,
          });
        }
      }
      
      // 温度异常警告（温度超过30度）
      if (room.currentTemp >= 30 && (!prev || prev.currentTemp < 30)) {
        newEvents.push({
          id: `${now.getTime()}-${room.roomId}-warning`,
          time: now,
          type: "warning",
          roomId: room.roomId,
          message: `⚠️ 房间 ${room.roomId} 温度过高 (${room.currentTemp.toFixed(1)}°C)`,
        });
      }
    });
    
    // 添加新事件，保留最近50条
    if (newEvents.length > 0) {
      setSystemEvents(prev => [...newEvents, ...prev].slice(0, 50));
    }
    
    // 更新前一次状态
    prevRoomsRef.current = rooms;
  }, [rooms]);

  // 初始化时添加一条系统启动事件
  useEffect(() => {
    setSystemEvents([{
      id: "system-start",
      time: new Date(),
      type: "start",
      message: "中央空调监控系统启动",
    }]);
  }, []);

  const activeRooms = useMemo(() => rooms.filter((room) => room.status !== "idle" || room.isServing || room.isWaiting), [rooms]);
  const serving = useMemo(() => rooms.filter((room) => room.isServing), [rooms]);
  const waiting = useMemo(() => rooms.filter((room) => room.isWaiting), [rooms]);
  
  // 生成100个房间，活跃房间放前面，之后按房间号从1到100排序
  const allRooms = useMemo(() => {
    // 创建房间ID到房间数据的映射
    const roomMap = new Map<string, RoomStatus>();
    rooms.forEach((r) => roomMap.set(String(r.roomId), r));
    
    // 生成所有100个房间（按房间号从1到100）
    const allRoomsList: RoomStatus[] = [];
    for (let roomNum = 1; roomNum <= 100; roomNum++) {
      const roomId = String(roomNum);
      const existingRoom = roomMap.get(roomId);
      if (existingRoom) {
        allRoomsList.push(existingRoom);
      } else {
        // 创建默认房间数据（与后端 RoomModel 默认值一致，都是 25）
        allRoomsList.push({
          roomId,
          status: "idle",
          currentTemp: 25,
          targetTemp: 25,
          speed: null,
          mode: null,
          currentFee: 0,
          totalFee: 0,
          servedSeconds: 0,
          isServing: false,
          isWaiting: false,
        } as RoomStatus);
      }
    }
    
    // 将房间分为三类：服务中、等待中、未使用
    const serving = allRoomsList.filter((r) => r.isServing);
    const waiting = allRoomsList.filter((r) => r.isWaiting && !r.isServing);
    const inactive = allRoomsList.filter((r) => !r.isServing && !r.isWaiting && r.status !== "running");
    
    // 按房间号排序（每类内部都排序）
    const sortByRoomId = (a: RoomStatus, b: RoomStatus) => {
      return parseInt(a.roomId) - parseInt(b.roomId);
    };
    
    return [
      ...serving.sort(sortByRoomId),
      ...waiting.sort(sortByRoomId),
      ...inactive.sort(sortByRoomId)
    ];
  }, [rooms]);

  // 统计数据
  const stats = useMemo(() => {
    const avgTemp = rooms.length > 0 ? rooms.reduce((s, r) => s + r.currentTemp, 0) / rooms.length : 0;
    const totalFee = rooms.reduce((s, r) => s + r.totalFee, 0);
    const totalServed = rooms.reduce((s, r) => s + r.servedSeconds, 0);
    const maxTemp = rooms.length > 0 ? Math.max(...rooms.map(r => r.currentTemp)) : 0;
    const minTemp = rooms.length > 0 ? Math.min(...rooms.map(r => r.currentTemp)) : 0;
    return { avgTemp, totalFee, totalServed, maxTemp, minTemp };
  }, [rooms]);

  // 风速分布
  const speedDist = useMemo(() => {
    const counts = { HIGH: 0, MID: 0, LOW: 0 };
    rooms.forEach((r) => {
      const s = r.speed || r.serviceSpeed || "";
      if (s === "HIGH" || s === "高") counts.HIGH++;
      else if (s === "MID" || s === "中") counts.MID++;
      else if (s === "LOW" || s === "低") counts.LOW++;
    });
    return counts;
  }, [rooms]);

  // 模式分布
  const modeDist = useMemo(() => {
    let cooling = 0, heating = 0;
    rooms.forEach((r) => {
      if (r.mode === "cooling" || r.mode === "制冷") cooling++;
      else if (r.mode === "heating" || r.mode === "制热") heating++;
    });
    return { cooling, heating };
  }, [rooms]);

  // 楼层房间映射（每层10个房间）
  const floorRooms = useMemo(() => {
    const floors: Record<number, RoomStatus[]> = {};
    for (let floor = 1; floor <= 10; floor++) {
      floors[floor] = [];
    }
    
    // 房间号分配：1-10为1楼，11-20为2楼...
    allRooms.forEach((room) => {
      const roomNum = parseInt(room.roomId);
      const floor = Math.ceil(roomNum / 10);
      if (floor >= 1 && floor <= 10) {
        floors[floor].push(room);
      }
    });
    
    // 确保每层房间按房间号排序
    for (let floor = 1; floor <= 10; floor++) {
      floors[floor].sort((a, b) => parseInt(a.roomId) - parseInt(b.roomId));
    }
    
    return floors;
  }, [allRooms]);

  // 获取当前显示的房间（根据选择的楼层和筛选条件过滤）
  const displayedRooms = useMemo(() => {
    let result: RoomStatus[];
    if (selectedFloor === null) {
      result = allRooms;
    } else {
      result = floorRooms[selectedFloor] || [];
    }
    
    // 如果开启了仅显示活跃房间，则过滤
    if (showActiveOnly) {
      result = result.filter(r => r.isServing || r.isWaiting || r.status === "running");
    }
    
    return result;
  }, [selectedFloor, allRooms, floorRooms, showActiveOnly]);

  // 处理楼层可视化中的房间点击
  const handleFloorRoomClick = useCallback((roomId: string) => {
    setHighlightedRoomId(roomId);
    const room = allRooms.find(r => r.roomId === roomId);
    if (room) {
      setSelectedRoom(room);
    }
    // 3秒后取消高亮
    setTimeout(() => setHighlightedRoomId(null), 3000);
  }, [allRooms]);

  return (
    <div 
      className="h-[calc(100vh-48px)] -mx-6 px-5 pt-0 pb-4 flex flex-col overflow-hidden"
      style={{
        background: `#f5f5f7`,
      }}
    >
      {/* 顶部状态栏 - 单行紧凑设计 */}
      <header className="flex items-center justify-between mb-2 flex-shrink-0 bg-white backdrop-blur-xl px-4 py-2 rounded-2xl mt-2 shadow-sm border border-black/[0.04]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#1d1d1f] rounded-xl flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
        </div>
        <div>
            <h1 className="text-sm font-semibold text-[#1d1d1f] tracking-tight leading-tight">
              酒店中央空调监控
          </h1>
            <p className="text-[9px] text-[#86868b] font-medium">
              HVAC Monitoring
            </p>
        </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* 状态指标 - 横向紧凑 */}
          <div className="flex gap-1.5">
            <StatusBadge label="总房间" value={100} color="slate" />
            <StatusBadge label="服务中" value={serving.length} color="primary" />
            <StatusBadge label="等待中" value={waiting.length} color="amber" />
            <StatusBadge label="活跃" value={activeRooms.length} color="blue" />
          </div>
          
          <div className="h-6 w-px bg-black/[0.06]"></div>
          
          {/* 时间显示 - 单行 */}
          <div className="flex items-center gap-2">
            <p className="text-base font-mono font-semibold text-[#1d1d1f] tabular-nums">
              {currentTime.toLocaleTimeString("zh-CN", { hour12: false })}
            </p>
            <p className="text-[10px] text-[#86868b] font-medium">
              {currentTime.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}
            </p>
              </div>
        </div>
      </header>

      {error && (
        <div className="mb-2 bg-[#ff3b30]/10 border border-[#ff3b30]/30 rounded-xl px-4 py-2 text-sm text-[#ff3b30] flex-shrink-0">
          {error}
        </div>
      )}

      {/* 主内容区：左右两栏布局 */}
      <div className="flex gap-2 flex-1 min-h-0">
        {/* 左侧：房间状态矩阵 */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-3 px-1 flex-shrink-0">
            <div className="flex items-center gap-4">
              <h2 className="text-base font-semibold text-[#1d1d1f] flex items-center gap-2.5">
                <span className="w-1 h-5 bg-[#0071e3] rounded-full"></span>
                房间状态
                <span className="text-xs font-normal text-[#86868b] ml-1">
                  {showActiveOnly ? `${displayedRooms.length} 间活跃` : "共 100 间"}
                </span>
              </h2>
              
              {/* 筛选切换按钮 */}
              <button
                onClick={() => setShowActiveOnly(!showActiveOnly)}
                className={`
                  flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full
                  transition-all duration-200
                  ${showActiveOnly 
                    ? "bg-[#1d1d1f] text-white" 
                    : "bg-[#f5f5f7] text-[#86868b] hover:text-[#1d1d1f]"
                  }
                `}
              >
                <span className={`w-2 h-2 rounded-full ${showActiveOnly ? "bg-white" : "bg-[#86868b]"}`}></span>
                仅活跃房间
              </button>
            </div>

            <div className="flex items-center gap-4 text-[11px]">
              <LegendItem color="#34c759" label="服务中" count={serving.length} pulse />
              <LegendItem color="#ff9500" label="等待中" count={waiting.length} />
              <LegendItem color="#e5e5e5" label="空闲" count={100 - activeRooms.length} />
            </div>
          </div>
          <div className={`${selectedFloor !== null ? "flex-none" : "flex-1"} overflow-auto custom-scrollbar bg-white rounded-2xl shadow-sm p-4 border border-black/[0.04]`}>
            <RoomStatusGrid 
              rooms={displayedRooms} 
              onRoomClick={setSelectedRoom}
              highlightedRoomId={highlightedRoomId}
            />
          </div>
          
          {/* 楼层专属能耗分析面板 - 仅在选择特定楼层时显示 */}
          {selectedFloor !== null && (
            <FloorAnalyticsPanel 
              floor={selectedFloor} 
              rooms={displayedRooms}
              tempHistory={tempHistory.get(selectedFloor)}
            />
          )}
        </main>

        {/* 右侧：楼层可视化 + 调度队列 */}
        <aside className="w-[480px] flex flex-col gap-2.5 flex-shrink-0">
          {/* 楼层3D可视化 */}
          <FloorVisualization
            floorRooms={floorRooms}
            selectedFloor={selectedFloor}
            onFloorSelect={setSelectedFloor}
            onRoomClick={handleFloorRoomClick}
          />

          {/* 调度队列 */}
          <Panel title="调度队列" icon="scheduler" color="primary">
            <div className="mb-4">
              <div className="flex justify-between text-xs text-[#86868b] mb-2">
                <span className="font-medium">服务槽占用</span>
                <span className="font-mono font-semibold text-[#1d1d1f]">{serving.length} / 3</span>
                  </div>
              <div className="h-2.5 bg-[#f5f5f7] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#1d1d1f] rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (serving.length / 3) * 100)}%` }}
                ></div>
                </div>
                  </div>
            <div className="grid grid-cols-2 gap-3">
              <QueueBox title="服务中" items={serving} type="serving" />
              <QueueBox title="等待队列" items={waiting} type="waiting" />
                  </div>
          </Panel>

          {/* 系统事件日志 */}
          <Panel title="事件日志" icon="log" color="primary" className="flex-1 min-h-0">
            <div className="h-[200px] overflow-y-scroll custom-scrollbar pr-1 pb-6">
              {systemEvents.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[#86868b] text-xs">
                  暂无事件记录
                </div>
              ) : (
                systemEvents.map((event) => (
                  <EventLogItem key={event.id} event={event} />
                ))
              )}
            </div>
          </Panel>
        </aside>
                  </div>

      {/* 房间详情弹窗 */}
      {selectedRoom && (
        <RoomDetailModal room={selectedRoom} onClose={() => setSelectedRoom(null)} />
      )}

      {/* 自定义滚动条样式 */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f5f5f7;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #c7c7cc;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #86868b;
        }
      `}</style>
                  </div>
  );
}

// 面板组件 - Apple风格设计
function Panel({ title, icon, color, children, className = "", noPadding = false }: { 
  title: string; 
  icon: string; 
  color: string;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  const colorMap: Record<string, { accent: string; bg: string }> = {
    primary: { accent: "bg-[#0071e3]", bg: "bg-white" },
    gray: { accent: "bg-[#86868b]", bg: "bg-white" },
    green: { accent: "bg-[#34c759]", bg: "bg-white" },
    blue: { accent: "bg-[#0071e3]", bg: "bg-white" },
  };
  const c = colorMap[color] || colorMap.primary;
  
  // 图标映射
  const iconMap: Record<string, React.ReactNode> = {
    scheduler: (
      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    log: (
      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    building: (
      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  };
  
  return (
    <div className={`bg-white rounded-2xl shadow-sm overflow-hidden border border-black/[0.04] ${className}`}>
      <div className="bg-[#f5f5f7] px-4 py-1.5 flex items-center gap-2 border-b border-black/[0.04]">
        <div className={`w-5 h-5 ${c.accent} rounded-lg flex items-center justify-center`}>
          {iconMap[icon] || <span className="text-xs text-white">{icon}</span>}
              </div>
        <span className="text-sm font-semibold text-[#1d1d1f]">{title}</span>
              </div>
      <div className={noPadding ? "" : "p-4"}>
        {children}
      </div>
    </div>
  );
}

// 状态徽章 - 横向紧凑风格
function StatusBadge({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, { bg: string; text: string; value: string }> = {
    slate: { bg: "bg-[#f5f5f7]", text: "text-[#86868b]", value: "text-[#1d1d1f]" },
    primary: { bg: "bg-[#0071e3]/10", text: "text-[#0071e3]", value: "text-[#0071e3]" },
    amber: { bg: "bg-[#ff9500]/10", text: "text-[#ff9500]", value: "text-[#ff9500]" },
    blue: { bg: "bg-[#0071e3]/10", text: "text-[#0071e3]", value: "text-[#0071e3]" },
  };
  const c = colors[color] || colors.slate;
  return (
    <div className={`px-2.5 py-1.5 ${c.bg} rounded-lg flex items-center gap-1.5`}>
      <span className={`text-[10px] font-medium ${c.text}`}>{label}</span>
      <span className={`text-sm font-semibold font-mono ${c.value} tabular-nums`}>{value}</span>
                  </div>
  );
}

// 图例项 - Apple风格
function LegendItem({ color, label, count, pulse }: { color: string; label: string; count: number; pulse?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[#86868b]">
      <span 
        className={`w-2.5 h-2.5 rounded-full ${pulse ? "animate-pulse" : ""}`} 
        style={{ backgroundColor: color }}
      ></span>
      <span className="font-medium">{label}</span>
      <span className="font-semibold text-[#1d1d1f] tabular-nums">{count}</span>
                </span>
  );
}

// 队列盒子 - Apple风格
function QueueBox({ title, items, type }: { title: string; items: RoomStatus[]; type: "serving" | "waiting" }) {
  const isServing = type === "serving";
  const bgColor = isServing ? "bg-[#34c759]/10" : "bg-[#ff9500]/10";
  const dotColor = isServing ? "bg-[#34c759]" : "bg-[#ff9500]";
  const textColor = isServing ? "text-[#34c759]" : "text-[#ff9500]";
  
  return (
    <div className={`${bgColor} p-3 rounded-xl`}>
      <p className={`text-[11px] font-semibold ${textColor} mb-2 flex items-center gap-1.5`}>
        <span className={`w-2 h-2 rounded-full ${dotColor}`}></span>
        {title}
        <span className="ml-auto font-mono">{items.length}</span>
      </p>
      <div className="space-y-1.5 max-h-20 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-[10px] text-[#86868b] text-center py-2">暂无</p>
        ) : (
          items.slice(0, 3).map((room) => (
            <div key={room.roomId} className="bg-white rounded-lg px-2.5 py-1.5 text-[11px] flex justify-between items-center">
              <span className="font-semibold text-[#1d1d1f]">#{room.roomId}</span>
              <span className="text-[#86868b] font-mono text-[10px]">{room.speed ?? "-"}</span>
                  </div>
          ))
        )}
                </div>
                  </div>
  );
}

// 事件日志项 - Apple风格，使用专业图标
function EventLogItem({ event }: { event: SystemEvent }) {
  const typeConfig: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
    // 对齐调度队列配色：绿 = 正常 / 成功，橙 = 等待 / 告警
    online: { 
      icon: <span className="w-2 h-2 rounded-full bg-[#34c759]"></span>,
      color: "text-[#34c759]",
      bg: "bg-[#34c759]/10"
    },
    offline: { 
      icon: <span className="w-2 h-2 rounded-full bg-[#86868b]"></span>,
      color: "text-[#86868b]",
      bg: "bg-[#f5f5f7]"
    },
    target_reached: { 
      icon: <span className="w-2 h-2 rounded-full bg-[#34c759]"></span>,
      color: "text-[#34c759]",
      bg: "bg-[#34c759]/10"
    },
    warning: { 
      icon: <span className="w-2 h-2 rounded-full bg-[#ff9500]"></span>,
      color: "text-[#ff9500]",
      bg: "bg-[#ff9500]/10"
    },
    info: { 
      icon: <span className="w-2 h-2 rounded-full bg-[#34c759]"></span>,
      color: "text-[#34c759]",
      bg: "bg-[#34c759]/10"
    },
    start: { 
      icon: <span className="w-2 h-2 rounded-full bg-[#0071e3]"></span>, 
      color: "text-[#0071e3]",
      bg: "bg-[#0071e3]/10"
    },
  };
  
  const config = typeConfig[event.type] || typeConfig.info;
  const timeStr = event.time.toLocaleTimeString("zh-CN", { 
    hour: "2-digit", 
    minute: "2-digit", 
    second: "2-digit",
    hour12: false 
  });
  
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-black/[0.04] last:border-0">
      <div className={`w-5 h-5 rounded-md ${config.bg} flex items-center justify-center flex-shrink-0`}>
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[#1d1d1f] leading-relaxed">
          {event.message}
        </p>
      </div>
      <span className="text-[10px] text-[#86868b] font-mono flex-shrink-0 tabular-nums">
        {timeStr}
                </span>
    </div>
  );
}

// 数据卡片 - Apple风格
function DataCard({ label, value, accent, size }: { label: string; value: string; accent: string; size?: string }) {
  const accents: Record<string, { bg: string; text: string }> = {
    blue: { bg: "bg-[#0071e3]/10", text: "text-[#0071e3]" },
    orange: { bg: "bg-[#ff9500]/10", text: "text-[#ff9500]" },
    green: { bg: "bg-[#34c759]/10", text: "text-[#34c759]" },
  };
  const a = accents[accent] || accents.blue;
  const isLg = size === "lg";
  
  return (
    <div className={`${a.bg} p-3 rounded-xl text-center`}>
      <p className="text-[9px] text-[#86868b]">{label}</p>
      <p className={`${isLg ? "text-xl" : "text-base"} font-bold ${a.text} font-mono`}>{value}</p>
                  </div>
  );
}

// 模式卡片 - Apple风格
function ModeCard({ label, count, icon, color }: { label: string; count: number; icon: string; color: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    blue: { bg: "bg-[#0071e3]/10", text: "text-[#0071e3]" },
    orange: { bg: "bg-[#ff9500]/10", text: "text-[#ff9500]" },
  };
  const c = colors[color] || colors.blue;
  
  return (
    <div className={`${c.bg} p-3 rounded-xl flex items-center gap-2`}>
      <span className="text-xl">{icon}</span>
                  <div>
        <p className="text-[9px] text-[#86868b]">{label}</p>
        <p className={`text-lg font-bold ${c.text} font-mono`}>{count}</p>
                  </div>
                </div>
  );
}

// 风速行 - Apple风格
function SpeedRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const percent = total > 0 ? (count / total) * 100 : 0;
  const colors: Record<string, { bar: string; text: string }> = {
    red: { bar: "bg-[#ff3b30]", text: "text-[#ff3b30]" },
    orange: { bar: "bg-[#ff9500]", text: "text-[#ff9500]" },
    green: { bar: "bg-[#34c759]", text: "text-[#34c759]" },
  };
  const c = colors[color] || colors.green;
  
  return (
                  <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-[#86868b] font-medium">{label}</span>
        <span className={`font-bold font-mono ${c.text}`}>{count}</span>
                  </div>
      <div className="h-2 bg-[#f5f5f7] rounded-full overflow-hidden">
        <div 
          className={`h-full ${c.bar} rounded-full transition-all duration-500`}
          style={{ width: `${percent}%` }}
        ></div>
                  </div>
                </div>
  );
}

// 楼层3D可视化组件 - Apple风格
function FloorVisualization({
  floorRooms,
  selectedFloor,
  onFloorSelect,
  onRoomClick,
}: {
  floorRooms: Record<number, RoomStatus[]>;
  selectedFloor: number | null;
  onFloorSelect: (floor: number | null) => void;
  onRoomClick: (roomId: string) => void;
}) {
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);

  // 获取房间颜色（根据温度和状态）
  const getRoomColor = (room: RoomStatus) => {
    const isActive = room.isServing || room.isWaiting || room.status === "running";
    if (!isActive) return { bg: "#e5e5e5", glow: "none", border: "#c7c7cc" };
    
    const temp = room.currentTemp;
    if (temp >= 30) return { bg: "#ff3b30", glow: "0 0 15px rgba(255,59,48,0.5)", border: "#ff3b30" };
    if (temp >= 28) return { bg: "#ff9500", glow: "0 0 12px rgba(255,149,0,0.4)", border: "#ff9500" };
    if (temp >= 26) return { bg: "#ffcc00", glow: "0 0 10px rgba(255,204,0,0.3)", border: "#ffcc00" };
    if (temp >= 24) return { bg: "#34c759", glow: "0 0 12px rgba(52,199,89,0.4)", border: "#34c759" };
    return { bg: "#0071e3", glow: "0 0 12px rgba(0,113,227,0.4)", border: "#0071e3" };
  };

  // 计算楼层统计
  const getFloorStats = (floor: number) => {
    const rooms = floorRooms[floor] || [];
    const active = rooms.filter(r => r.isServing || r.isWaiting || r.status === "running").length;
    return { total: rooms.length, active };
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col border border-black/[0.04]" style={{ maxHeight: "65%" }}>
      {/* 头部 */}
      <div className="bg-[#f5f5f7] px-4 py-1.5 flex items-center justify-between border-b border-black/[0.04]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-[#0071e3] rounded-lg flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-[#1d1d1f]">楼层可视化</span>
              </div>
              <button
          onClick={() => onFloorSelect(null)}
          className={`px-3 py-1.5 text-[10px] font-medium rounded-full transition-all ${
            selectedFloor === null 
              ? "bg-[#1d1d1f] text-white" 
              : "bg-white text-[#86868b] hover:text-[#1d1d1f] border border-black/[0.06]"
          }`}
        >
          全部
              </button>
            </div>

      {/* 楼层选择器 - 单行显示 */}
      <div className="px-3 py-2 bg-[#f5f5f7]/50 border-b border-black/[0.04]">
        <div className="flex gap-1 justify-between">
          {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((floor) => {
            const stats = getFloorStats(floor);
            const isSelected = selectedFloor === floor;
            const hasActive = stats.active > 0;
            
            return (
                <button
                key={floor}
                onClick={() => onFloorSelect(isSelected ? null : floor)}
                className={`
                  relative flex-1 h-7 text-[10px] font-semibold rounded-lg transition-all duration-200
                  ${isSelected 
                    ? "bg-[#0071e3] text-white scale-105 z-10" 
                    : hasActive
                      ? "bg-[#0071e3]/10 text-[#0071e3] hover:scale-105"
                      : "bg-white text-[#86868b] hover:bg-[#f5f5f7] border border-black/[0.04]"
                  }
                `}
              >
                {floor}F
                {hasActive && !isSelected && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-[#0071e3] rounded-full animate-pulse"></span>
                )}
                </button>
            );
          })}
                  </div>
            </div>

      {/* 楼层展示区 */}
      <div className="flex-1 px-2 py-1 overflow-auto">
        {selectedFloor === null ? (
          // 显示所有楼层的堆叠视图
          <div className="flex flex-col items-center gap-0.5">
            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((floor) => {
              const rooms = floorRooms[floor] || [];
              const stats = getFloorStats(floor);
              
              return (
                <div
                  key={floor}
                  className="cursor-pointer group"
                  onClick={() => onFloorSelect(floor)}
                >
                  {/* 楼层平台 */}
                  <div 
                    className={`
                      relative transition-all duration-300
                      ${stats.active > 0 ? "opacity-100" : "opacity-70"}
                      group-hover:scale-[1.02] group-hover:opacity-100
                    `}
                    style={{
                      width: "440px",
                      height: "32px",
                      background: stats.active > 0 
                        ? "linear-gradient(135deg, #e5f4ff 0%, #e5f4ff 100%)"
                        : "linear-gradient(135deg, #f5f5f7 0%, #e5e5e5 100%)",
                      borderRadius: "8px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                      border: `1px solid ${stats.active > 0 ? "#0071e3" : "#c7c7cc"}`,
                    }}
                  >
                    {/* 楼层标签 */}
                    <div className="absolute left-2 top-1/2 -translate-y-1/2 px-2.5 py-0.5 bg-[#1d1d1f] text-white text-[9px] font-bold rounded-md">
                      {floor}F
                  </div>
                    
                    {/* 房间小方块 */}
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
                      {rooms.slice(0, 10).map((room) => {
                        const color = getRoomColor(room);
                        const isHovered = hoveredRoom === room.roomId;
                        
                        return (
                          <div
                            key={room.roomId}
                            className={`relative flex items-center justify-center cursor-pointer transition-all duration-200 rounded ${isHovered ? "scale-125 z-10" : ""}`}
                            style={{
                              width: "32px",
                              height: "20px",
                              backgroundColor: color.bg,
                              boxShadow: color.glow,
                              border: `1px solid ${color.border}`,
                            }}
                            onMouseEnter={() => setHoveredRoom(room.roomId)}
                            onMouseLeave={() => setHoveredRoom(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRoomClick(room.roomId);
                            }}
                          >
                            <span 
                              className="text-[8px] font-bold leading-none text-[#1d1d1f]"
                            >
                              {room.roomId}
                  </span>
                </div>
                        );
                      })}
                  </div>
                  </div>
                  </div>
              );
            })}
                </div>
        ) : (
          // 显示单层详细视图
          <SingleFloorView
            floor={selectedFloor}
            rooms={floorRooms[selectedFloor] || []}
            hoveredRoom={hoveredRoom}
            onHover={setHoveredRoom}
            onRoomClick={onRoomClick}
            getRoomColor={getRoomColor}
          />
        )}
          </div>

      {/* 底部统计 */}
      <div className="px-4 py-2.5 bg-[#f5f5f7] border-t border-black/[0.04]">
        <div className="flex justify-between items-center text-[10px]">
          <div className="flex gap-4">
            {(() => {
              // 根据选择的楼层计算统计数据
              const displayRooms = selectedFloor === null 
                ? Object.values(floorRooms).flat()
                : (floorRooms[selectedFloor] || []);
              
              const avgTemp = displayRooms.length > 0 
                ? displayRooms.reduce((s, r) => s + r.currentTemp, 0) / displayRooms.length 
                : 0;
              
              let cooling = 0, heating = 0;
              displayRooms.forEach((r) => {
                if (r.isServing || r.isWaiting || r.status === "running") {
                  if (r.currentTemp > r.targetTemp) {
                    cooling++;
                  } else if (r.currentTemp < r.targetTemp) {
                    heating++;
                  }
                }
              });
              
              return (
                <>
                  <span className="text-[#86868b]">
                    平均温度 <span className="font-semibold text-[#1d1d1f] ml-1">{avgTemp.toFixed(1)}°C</span>
                  </span>
                  <span className="text-[#86868b]">
                    制冷 <span className="font-semibold text-[#0071e3] ml-1">{cooling}</span>
                  </span>
                  <span className="text-[#86868b]">
                    制热 <span className="font-semibold text-[#ff9500] ml-1">{heating}</span>
                  </span>
                </>
              );
            })()}
                  </div>
          {hoveredRoom && (
            <span className="text-[#0071e3] font-semibold">
              房间 #{hoveredRoom}
                  </span>
          )}
                </div>
                  </div>
                  </div>
  );
}

// 楼层布局配置 - 每层都有独特的建筑结构
const FLOOR_BLUEPRINTS: Record<number, {
  rooms: Array<{ id: number; x: number; y: number; w: number; h: number; type: 'standard' | 'suite' | 'corner' | 'deluxe'; doorSide: 'top' | 'bottom' | 'left' | 'right' }>;
  corridors: Array<{ x: number; y: number; w: number; h: number }>;
  elevator: { x: number; y: number };
  stairs: { x: number; y: number };
}> = {
  // 1楼：大堂层，L型走廊，有套房
  1: {
    rooms: [
      { id: 1, x: 10, y: 10, w: 50, h: 40, type: 'suite', doorSide: 'bottom' },
      { id: 2, x: 65, y: 10, w: 40, h: 40, type: 'standard', doorSide: 'bottom' },
      { id: 3, x: 110, y: 10, w: 40, h: 40, type: 'standard', doorSide: 'bottom' },
      { id: 4, x: 155, y: 10, w: 45, h: 40, type: 'deluxe', doorSide: 'bottom' },
      { id: 5, x: 205, y: 10, w: 40, h: 40, type: 'standard', doorSide: 'bottom' },
      { id: 6, x: 250, y: 10, w: 50, h: 40, type: 'suite', doorSide: 'bottom' },
      { id: 7, x: 10, y: 95, w: 40, h: 35, type: 'standard', doorSide: 'top' },
      { id: 8, x: 55, y: 95, w: 45, h: 35, type: 'deluxe', doorSide: 'top' },
      { id: 9, x: 205, y: 95, w: 45, h: 35, type: 'deluxe', doorSide: 'top' },
      { id: 10, x: 255, y: 95, w: 45, h: 35, type: 'corner', doorSide: 'top' },
    ],
    corridors: [
      { x: 5, y: 52, w: 300, h: 40 },
      { x: 105, y: 92, w: 95, h: 45 },
    ],
    elevator: { x: 140, y: 100 },
    stairs: { x: 175, y: 100 },
  },
  // 2楼：标准客房层，直线走廊
  2: {
    rooms: [
      { id: 11, x: 10, y: 8, w: 42, h: 38, type: 'standard', doorSide: 'bottom' },
      { id: 12, x: 56, y: 8, w: 42, h: 38, type: 'standard', doorSide: 'bottom' },
      { id: 13, x: 102, y: 8, w: 48, h: 38, type: 'deluxe', doorSide: 'bottom' },
      { id: 14, x: 154, y: 8, w: 42, h: 38, type: 'standard', doorSide: 'bottom' },
      { id: 15, x: 200, y: 8, w: 48, h: 38, type: 'deluxe', doorSide: 'bottom' },
      { id: 16, x: 10, y: 90, w: 42, h: 38, type: 'standard', doorSide: 'top' },
      { id: 17, x: 56, y: 90, w: 48, h: 38, type: 'deluxe', doorSide: 'top' },
      { id: 18, x: 108, y: 90, w: 42, h: 38, type: 'standard', doorSide: 'top' },
      { id: 19, x: 154, y: 90, w: 42, h: 38, type: 'standard', doorSide: 'top' },
      { id: 20, x: 200, y: 90, w: 48, h: 38, type: 'suite', doorSide: 'top' },
    ],
    corridors: [{ x: 5, y: 48, w: 248, h: 38 }],
    elevator: { x: 255, y: 55 },
    stairs: { x: 255, y: 90 },
  },
  // 3楼：T型走廊
  3: {
    rooms: [
      { id: 21, x: 8, y: 8, w: 44, h: 36, type: 'corner', doorSide: 'right' },
      { id: 22, x: 8, y: 48, w: 44, h: 36, type: 'standard', doorSide: 'right' },
      { id: 23, x: 8, y: 88, w: 44, h: 40, type: 'suite', doorSide: 'right' },
      { id: 24, x: 90, y: 8, w: 40, h: 34, type: 'standard', doorSide: 'bottom' },
      { id: 25, x: 134, y: 8, w: 40, h: 34, type: 'standard', doorSide: 'bottom' },
      { id: 26, x: 178, y: 8, w: 44, h: 34, type: 'deluxe', doorSide: 'bottom' },
      { id: 27, x: 90, y: 94, w: 44, h: 34, type: 'deluxe', doorSide: 'top' },
      { id: 28, x: 138, y: 94, w: 40, h: 34, type: 'standard', doorSide: 'top' },
      { id: 29, x: 182, y: 94, w: 40, h: 34, type: 'standard', doorSide: 'top' },
      { id: 30, x: 226, y: 48, w: 44, h: 36, type: 'corner', doorSide: 'left' },
    ],
    corridors: [
      { x: 55, y: 8, w: 30, h: 120 },
      { x: 55, y: 44, w: 168, h: 44 },
    ],
    elevator: { x: 230, y: 8 },
    stairs: { x: 230, y: 100 },
  },
  // 4楼：U型走廊
  4: {
    rooms: [
      { id: 31, x: 8, y: 10, w: 38, h: 45, type: 'suite', doorSide: 'right' },
      { id: 32, x: 8, y: 60, w: 38, h: 35, type: 'standard', doorSide: 'right' },
      { id: 33, x: 8, y: 100, w: 38, h: 35, type: 'standard', doorSide: 'right' },
      { id: 34, x: 85, y: 10, w: 36, h: 30, type: 'standard', doorSide: 'bottom' },
      { id: 35, x: 125, y: 10, w: 40, h: 30, type: 'deluxe', doorSide: 'bottom' },
      { id: 36, x: 169, y: 10, w: 36, h: 30, type: 'standard', doorSide: 'bottom' },
      { id: 37, x: 85, y: 105, w: 36, h: 30, type: 'standard', doorSide: 'top' },
      { id: 38, x: 125, y: 105, w: 40, h: 30, type: 'deluxe', doorSide: 'top' },
      { id: 39, x: 169, y: 105, w: 36, h: 30, type: 'standard', doorSide: 'top' },
      { id: 40, x: 210, y: 50, w: 45, h: 40, type: 'corner', doorSide: 'left' },
    ],
    corridors: [
      { x: 50, y: 10, w: 30, h: 125 },
      { x: 50, y: 42, w: 156, h: 28 },
      { x: 50, y: 70, w: 156, h: 28 },
    ],
    elevator: { x: 215, y: 10 },
    stairs: { x: 215, y: 100 },
  },
  // 5楼：回字型走廊
  5: {
    rooms: [
      { id: 41, x: 8, y: 8, w: 42, h: 32, type: 'standard', doorSide: 'bottom' },
      { id: 42, x: 54, y: 8, w: 42, h: 32, type: 'standard', doorSide: 'bottom' },
      { id: 43, x: 100, y: 8, w: 50, h: 32, type: 'suite', doorSide: 'bottom' },
      { id: 44, x: 154, y: 8, w: 42, h: 32, type: 'standard', doorSide: 'bottom' },
      { id: 45, x: 200, y: 8, w: 42, h: 32, type: 'standard', doorSide: 'bottom' },
      { id: 46, x: 8, y: 100, w: 42, h: 32, type: 'standard', doorSide: 'top' },
      { id: 47, x: 54, y: 100, w: 42, h: 32, type: 'standard', doorSide: 'top' },
      { id: 48, x: 100, y: 100, w: 50, h: 32, type: 'suite', doorSide: 'top' },
      { id: 49, x: 154, y: 100, w: 42, h: 32, type: 'standard', doorSide: 'top' },
      { id: 50, x: 200, y: 100, w: 42, h: 32, type: 'standard', doorSide: 'top' },
    ],
    corridors: [
      { x: 5, y: 42, w: 240, h: 24 },
      { x: 5, y: 74, w: 240, h: 24 },
      { x: 246, y: 42, w: 24, h: 56 },
    ],
    elevator: { x: 250, y: 8 },
    stairs: { x: 250, y: 100 },
  },
  // 6-10楼使用不同的变体布局
  6: {
    rooms: [
      { id: 51, x: 10, y: 10, w: 55, h: 42, type: 'suite', doorSide: 'bottom' },
      { id: 52, x: 70, y: 10, w: 38, h: 42, type: 'standard', doorSide: 'bottom' },
      { id: 53, x: 112, y: 10, w: 38, h: 42, type: 'standard', doorSide: 'bottom' },
      { id: 54, x: 154, y: 10, w: 45, h: 42, type: 'deluxe', doorSide: 'bottom' },
      { id: 55, x: 203, y: 10, w: 55, h: 42, type: 'corner', doorSide: 'bottom' },
      { id: 56, x: 10, y: 92, w: 45, h: 38, type: 'deluxe', doorSide: 'top' },
      { id: 57, x: 60, y: 92, w: 38, h: 38, type: 'standard', doorSide: 'top' },
      { id: 58, x: 102, y: 92, w: 50, h: 38, type: 'suite', doorSide: 'top' },
      { id: 59, x: 156, y: 92, w: 38, h: 38, type: 'standard', doorSide: 'top' },
      { id: 60, x: 198, y: 92, w: 60, h: 38, type: 'corner', doorSide: 'top' },
    ],
    corridors: [{ x: 5, y: 54, w: 258, h: 35 }],
    elevator: { x: 268, y: 56 },
    stairs: { x: 268, y: 95 },
  },
  7: {
    rooms: [
      { id: 61, x: 8, y: 8, w: 40, h: 35, type: 'standard', doorSide: 'bottom' },
      { id: 62, x: 52, y: 8, w: 48, h: 35, type: 'deluxe', doorSide: 'bottom' },
      { id: 63, x: 104, y: 8, w: 40, h: 35, type: 'standard', doorSide: 'bottom' },
      { id: 64, x: 148, y: 8, w: 55, h: 35, type: 'suite', doorSide: 'bottom' },
      { id: 65, x: 207, y: 8, w: 48, h: 35, type: 'corner', doorSide: 'left' },
      { id: 66, x: 8, y: 95, w: 48, h: 35, type: 'deluxe', doorSide: 'top' },
      { id: 67, x: 60, y: 95, w: 40, h: 35, type: 'standard', doorSide: 'top' },
      { id: 68, x: 104, y: 95, w: 55, h: 35, type: 'suite', doorSide: 'top' },
      { id: 69, x: 163, y: 95, w: 40, h: 35, type: 'standard', doorSide: 'top' },
      { id: 70, x: 207, y: 50, w: 48, h: 40, type: 'corner', doorSide: 'left' },
    ],
    corridors: [
      { x: 5, y: 45, w: 198, h: 45 },
      { x: 203, y: 8, w: 4, h: 122 },
    ],
    elevator: { x: 260, y: 20 },
    stairs: { x: 260, y: 100 },
  },
  8: {
    rooms: [
      { id: 71, x: 10, y: 8, w: 52, h: 40, type: 'suite', doorSide: 'bottom' },
      { id: 72, x: 66, y: 8, w: 40, h: 40, type: 'standard', doorSide: 'bottom' },
      { id: 73, x: 110, y: 8, w: 45, h: 40, type: 'deluxe', doorSide: 'bottom' },
      { id: 74, x: 159, y: 8, w: 40, h: 40, type: 'standard', doorSide: 'bottom' },
      { id: 75, x: 203, y: 8, w: 52, h: 40, type: 'suite', doorSide: 'bottom' },
      { id: 76, x: 10, y: 92, w: 40, h: 38, type: 'standard', doorSide: 'top' },
      { id: 77, x: 54, y: 92, w: 45, h: 38, type: 'deluxe', doorSide: 'top' },
      { id: 78, x: 103, y: 92, w: 52, h: 38, type: 'suite', doorSide: 'top' },
      { id: 79, x: 159, y: 92, w: 45, h: 38, type: 'deluxe', doorSide: 'top' },
      { id: 80, x: 208, y: 92, w: 47, h: 38, type: 'corner', doorSide: 'top' },
    ],
    corridors: [{ x: 5, y: 50, w: 255, h: 40 }],
    elevator: { x: 260, y: 55 },
    stairs: { x: 260, y: 95 },
  },
  9: {
    rooms: [
      { id: 81, x: 8, y: 10, w: 48, h: 38, type: 'deluxe', doorSide: 'bottom' },
      { id: 82, x: 60, y: 10, w: 40, h: 38, type: 'standard', doorSide: 'bottom' },
      { id: 83, x: 104, y: 10, w: 40, h: 38, type: 'standard', doorSide: 'bottom' },
      { id: 84, x: 148, y: 10, w: 48, h: 38, type: 'deluxe', doorSide: 'bottom' },
      { id: 85, x: 200, y: 10, w: 55, h: 38, type: 'suite', doorSide: 'bottom' },
      { id: 86, x: 8, y: 92, w: 55, h: 38, type: 'suite', doorSide: 'top' },
      { id: 87, x: 67, y: 92, w: 40, h: 38, type: 'standard', doorSide: 'top' },
      { id: 88, x: 111, y: 92, w: 48, h: 38, type: 'deluxe', doorSide: 'top' },
      { id: 89, x: 163, y: 92, w: 40, h: 38, type: 'standard', doorSide: 'top' },
      { id: 90, x: 207, y: 92, w: 48, h: 38, type: 'corner', doorSide: 'top' },
    ],
    corridors: [{ x: 5, y: 50, w: 255, h: 40 }],
    elevator: { x: 260, y: 55 },
    stairs: { x: 260, y: 95 },
  },
  10: {
    rooms: [
      { id: 91, x: 10, y: 8, w: 60, h: 45, type: 'suite', doorSide: 'bottom' },
      { id: 92, x: 75, y: 8, w: 55, h: 45, type: 'suite', doorSide: 'bottom' },
      { id: 93, x: 135, y: 8, w: 55, h: 45, type: 'suite', doorSide: 'bottom' },
      { id: 94, x: 195, y: 8, w: 60, h: 45, type: 'corner', doorSide: 'bottom' },
      { id: 95, x: 10, y: 88, w: 55, h: 42, type: 'suite', doorSide: 'top' },
      { id: 96, x: 70, y: 88, w: 50, h: 42, type: 'deluxe', doorSide: 'top' },
      { id: 97, x: 125, y: 88, w: 50, h: 42, type: 'deluxe', doorSide: 'top' },
      { id: 98, x: 180, y: 88, w: 40, h: 42, type: 'standard', doorSide: 'top' },
      { id: 99, x: 225, y: 88, w: 40, h: 42, type: 'standard', doorSide: 'top' },
      { id: 100, x: 260, y: 50, w: 35, h: 35, type: 'corner', doorSide: 'left' },
    ],
    corridors: [
      { x: 5, y: 55, w: 252, h: 30 },
      { x: 257, y: 8, w: 38, h: 77 },
    ],
    elevator: { x: 270, y: 88 },
    stairs: { x: 270, y: 120 },
  },
};

// 单层详细视图组件 - 真实酒店平面图风格
function SingleFloorView({
  floor,
  rooms,
  hoveredRoom,
  onHover,
  onRoomClick,
  getRoomColor,
}: {
  floor: number;
  rooms: RoomStatus[];
  hoveredRoom: string | null;
  onHover: (roomId: string | null) => void;
  onRoomClick: (roomId: string) => void;
  getRoomColor: (room: RoomStatus) => { bg: string; glow: string; border: string };
}) {
  const blueprint = FLOOR_BLUEPRINTS[floor] || FLOOR_BLUEPRINTS[2];
  const roomMap = new Map(rooms.map(r => [parseInt(r.roomId), r]));
  
  // 缩放比例 - 原来基于320x160，现在是400x200
  const scale = 1.25;

  // 房间类型配置 - Apple风格
  const roomTypeConfig = {
    standard: { label: '标准', wallColor: '#86868b' },
    deluxe: { label: '豪华', wallColor: '#0071e3' },
    suite: { label: '套房', wallColor: '#8B5CF6' },
    corner: { label: '转角', wallColor: '#34c759' },
  };

  return (
    <div className="h-full flex flex-col">
      {/* 楼层标题 */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 bg-[#0071e3] text-white text-xs font-semibold rounded-lg">
            {floor}F
                  </div>
          <span className="text-[11px] text-[#86868b] font-medium">楼层平面图</span>
                  </div>
        <div className="flex gap-2 text-[8px]">
          {Object.entries(roomTypeConfig).map(([type, config]) => (
            <span key={type} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: config.wallColor }}></span>
              <span className="text-[#86868b]">{config.label}</span>
            </span>
          ))}
                </div>
                </div>

      {/* 3D建筑平面图 */}
      <div 
        className="flex-1 flex items-center justify-center overflow-hidden"
        style={{ perspective: "1200px" }}
      >
        <div
          className="relative"
          style={{
            width: "400px",
            height: "200px",
            transform: "rotateX(45deg) rotateZ(-2deg)",
            transformStyle: "preserve-3d",
          }}
        >
          {/* 地板 */}
          <div 
            className="absolute inset-0 rounded-lg"
            style={{
              background: "linear-gradient(135deg, #f5f5f7 0%, #e5e5e5 50%, #d1d1d6 100%)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2), inset 0 0 60px rgba(0,0,0,0.03)",
              border: "2px solid #c7c7cc",
            }}
          />

          {/* 走廊 */}
          {blueprint.corridors.map((corridor, idx) => (
            <div
              key={`corridor-${idx}`}
              className="absolute rounded"
              style={{
                left: `${corridor.x * scale}px`,
                top: `${corridor.y * scale}px`,
                width: `${corridor.w * scale}px`,
                height: `${corridor.h * scale}px`,
                background: "linear-gradient(180deg, #d1d1d6 0%, #aeaeb2 50%, #8e8e93 100%)",
                boxShadow: "inset 0 2px 8px rgba(0,0,0,0.1)",
                transform: "translateZ(2px)",
              }}
            >
              {/* 走廊地砖纹理 */}
              <div 
                className="absolute inset-0 opacity-10"
                style={{
                  backgroundImage: `
                    linear-gradient(90deg, transparent 49%, #636366 49%, #636366 51%, transparent 51%),
                    linear-gradient(0deg, transparent 49%, #636366 49%, #636366 51%, transparent 51%)
                  `,
                  backgroundSize: "20px 20px",
                }}
              />
                  </div>
          ))}

          {/* 电梯 */}
          <div
            className="absolute flex items-center justify-center rounded-lg"
            style={{
              left: `${blueprint.elevator.x * scale}px`,
              top: `${blueprint.elevator.y * scale}px`,
              width: "32px",
              height: "32px",
              background: "#1d1d1f",
              border: "2px solid #636366",
              boxShadow: "0 4px 8px rgba(0,0,0,0.2)",
              transform: "translateZ(8px)",
            }}
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8M8 12h8m-4-9v18" />
            </svg>
                </div>

          {/* 楼梯 */}
          <div
            className="absolute rounded"
            style={{
              left: `${blueprint.stairs.x * scale}px`,
              top: `${blueprint.stairs.y * scale}px`,
              width: "28px",
              height: "24px",
              background: "repeating-linear-gradient(90deg, #86868b 0px, #86868b 5px, #aeaeb2 5px, #aeaeb2 10px)",
              border: "2px solid #636366",
              boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
              transform: "translateZ(4px)",
            }}
          />

          {/* 房间 */}
          {blueprint.rooms.map((roomConfig) => {
            const roomData = roomMap.get(roomConfig.id);
            const isActive = roomData && (roomData.isServing || roomData.isWaiting || roomData.status === "running");
            const isHovered = hoveredRoom === String(roomConfig.id);
            const color = roomData ? getRoomColor(roomData) : { bg: "#94A3B8", glow: "none", border: "#CBD5E1" };
            const typeConfig = roomTypeConfig[roomConfig.type];

            // 门的位置
            const doorStyles: Record<string, React.CSSProperties> = {
              top: { left: "50%", top: "-2px", transform: "translateX(-50%)", width: "14px", height: "5px" },
              bottom: { left: "50%", bottom: "-2px", transform: "translateX(-50%)", width: "14px", height: "5px" },
              left: { left: "-2px", top: "50%", transform: "translateY(-50%)", width: "5px", height: "14px" },
              right: { right: "-2px", top: "50%", transform: "translateY(-50%)", width: "5px", height: "14px" },
            };

            return (
              <div
                key={roomConfig.id}
                className={`absolute cursor-pointer transition-all duration-300 ${isHovered ? "z-20" : "z-10"}`}
                style={{
                  left: `${roomConfig.x * scale}px`,
                  top: `${roomConfig.y * scale}px`,
                  width: `${roomConfig.w * scale}px`,
                  height: `${roomConfig.h * scale}px`,
                  transform: isHovered 
                    ? "translateZ(20px) scale(1.05)" 
                    : `translateZ(${isActive ? 12 : 6}px)`,
                  transformStyle: "preserve-3d",
                }}
                onMouseEnter={() => onHover(String(roomConfig.id))}
                onMouseLeave={() => onHover(null)}
                onClick={() => onRoomClick(String(roomConfig.id))}
              >
                {/* 房间3D盒子 - 底部阴影 */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    transform: "translateZ(-6px)",
                    filter: "blur(4px)",
                  }}
                />

                {/* 房间3D盒子 - 侧面墙 */}
                <div
                  className="absolute"
                  style={{
                    left: 0,
                    bottom: 0,
                    width: "100%",
                    height: "8px",
                    background: `linear-gradient(180deg, ${typeConfig.wallColor} 0%, ${typeConfig.wallColor}99 100%)`,
                    transform: "rotateX(90deg) translateZ(4px)",
                    transformOrigin: "bottom",
                  }}
                />
                <div
                  className="absolute"
                  style={{
                    right: 0,
                    top: 0,
                    width: "8px",
                    height: "100%",
                    background: `linear-gradient(90deg, ${typeConfig.wallColor}99 0%, ${typeConfig.wallColor} 100%)`,
                    transform: "rotateY(-90deg) translateZ(4px)",
                    transformOrigin: "right",
                  }}
                />

                {/* 房间顶面 */}
                <div
                  className="absolute inset-0 overflow-hidden rounded"
                  style={{
                    background: isActive 
                      ? `linear-gradient(135deg, ${color.bg} 0%, ${color.bg}dd 100%)`
                      : `linear-gradient(135deg, #f5f5f7 0%, #e5e5e5 100%)`,
                    border: `2px solid ${typeConfig.wallColor}`,
                    boxShadow: isActive 
                      ? `${color.glow}, inset 0 0 20px rgba(255,255,255,0.3)` 
                      : "inset 0 0 15px rgba(0,0,0,0.05)",
                  }}
                >
                  {/* 房间内部纹理 */}
                  {!isActive && (
                    <div 
                      className="absolute inset-2 opacity-20"
                      style={{
                        background: "linear-gradient(45deg, transparent 48%, #c7c7cc 48%, #c7c7cc 52%, transparent 52%)",
                        backgroundSize: "8px 8px",
                      }}
                    />
                  )}

                  {/* 房间信息 */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span 
                      className={`text-[10px] font-bold ${isActive ? "text-white" : "text-[#86868b]"}`}
                      style={{ textShadow: isActive ? "0 1px 2px rgba(0,0,0,0.3)" : "none" }}
                    >
                      {roomConfig.id}
                    </span>
                    {isActive && roomData && (
                      <span className="text-[7px] text-white/90 font-mono mt-0.5">
                        {roomData.currentTemp.toFixed(0)}°C
                      </span>
                    )}
                  </div>

                  {/* 窗户 */}
                  {(roomConfig.type === 'suite' || roomConfig.type === 'corner') && (
                    <div
                      className="absolute rounded-sm"
                      style={{
                        ...(roomConfig.doorSide === 'top' || roomConfig.doorSide === 'bottom' 
                          ? { top: "3px", right: "3px", width: "40%", height: "3px" }
                          : { top: "3px", right: "3px", width: "3px", height: "40%" }
                        ),
                        background: "linear-gradient(90deg, #5ac8fa, #007aff, #5ac8fa)",
                        boxShadow: "0 0 4px rgba(90,200,250,0.4)",
                      }}
                    />
                  )}

                  {/* 空调工作指示灯 */}
                  {isActive && (
                    <div 
                      className="absolute top-1 right-1 w-2 h-2 animate-pulse rounded-full"
                      style={{
                        background: roomData?.isServing 
                          ? "radial-gradient(circle, #34c759 0%, #30d158 100%)"
                          : "radial-gradient(circle, #ff9500 0%, #ff9f0a 100%)",
                        boxShadow: roomData?.isServing 
                          ? "0 0 6px rgba(52,199,89,0.6)" 
                          : "0 0 6px rgba(255,149,0,0.6)",
                      }}
                    />
                  )}
                </div>

                {/* 门 */}
                <div
                  className="absolute rounded-sm"
                  style={{
                    ...doorStyles[roomConfig.doorSide],
                    background: isActive 
                      ? "linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.3))"
                      : "linear-gradient(180deg, #ff9500, #ff9f0a)",
                    boxShadow: "0 0 3px rgba(0,0,0,0.2)",
                    zIndex: 5,
                  }}
                />
              </div>
            );
          })}

          {/* 指北针 */}
          <div
            className="absolute flex items-center justify-center"
            style={{
              right: "5px",
              top: "5px",
              width: "20px",
              height: "20px",
              background: "rgba(255,255,255,0.9)",
              border: "1px solid #c7c7cc",
              borderRadius: "50%",
              transform: "translateZ(15px)",
              fontSize: "8px",
              color: "#1d1d1f",
            }}
          >
            <span style={{ transform: "rotate(45deg)" }}>↑N</span>
          </div>
        </div>
      </div>

      {/* 图例 */}
      <div className="flex justify-center gap-4 mt-2 text-[9px]">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#34c759]"></span>
          <span className="text-[#86868b]">服务中</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff9500]"></span>
          <span className="text-[#86868b]">等待中</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-[#f5f5f7] border border-[#c7c7cc]"></span>
          <span className="text-[#86868b]">空闲</span>
        </span>
        <span className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8M8 12h8m-4-9v18" />
          </svg>
          <span className="text-[#86868b]">电梯</span>
        </span>
      </div>
    </div>
  );
}

// 房间详情弹窗 - Apple风格
function RoomDetailModal({ room, onClose }: { room: RoomStatus; onClose: () => void }) {
  // 状态配置
  const statusConfig = {
    serving: { label: "服务中", color: "text-[#34c759]", icon: <span className="w-2 h-2 rounded-full bg-[#34c759]"></span> },
    waiting: { label: "等待中", color: "text-[#ff9500]", icon: <span className="w-2 h-2 rounded-full bg-[#ff9500]"></span> },
    idle: { label: "空闲", color: "text-[#86868b]", icon: <span className="w-2 h-2 rounded-full bg-[#c7c7cc]"></span> },
  };
  const currentStatus = room.isServing ? statusConfig.serving : room.isWaiting ? statusConfig.waiting : statusConfig.idle;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm"></div>
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="bg-[#f5f5f7] px-6 py-5 border-b border-black/[0.04] rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-[#0071e3] rounded-2xl flex items-center justify-center text-white text-xl font-bold">
                {room.roomId}
              </div>
                  <div>
                <h2 className="text-xl font-semibold text-[#1d1d1f]">房间 #{room.roomId}</h2>
                <p className={`text-sm ${currentStatus.color} mt-0.5 flex items-center gap-1.5`}>
                  {currentStatus.icon}
                  {currentStatus.label}
                    </p>
                  </div>
            </div>
            <button 
              onClick={onClose} 
              className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#e5e5e5] transition-all border border-black/[0.04]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-5">
          {/* 温度 */}
          <div className="grid grid-cols-2 gap-5">
            <div className="bg-[#f5f5f7] p-5 rounded-xl">
              <p className="text-xs text-[#86868b] mb-2">当前温度</p>
              <p className={`text-3xl font-semibold font-mono tabular-nums ${
                room.currentTemp >= 28 ? "text-[#ff3b30]" : 
                room.currentTemp >= 26 ? "text-[#ff9500]" : "text-[#0071e3]"
              }`}>
                {room.currentTemp.toFixed(1)}℃
                    </p>
                  </div>
            <div className="bg-[#f5f5f7] p-5 rounded-xl">
              <p className="text-xs text-[#86868b] mb-2">目标温度</p>
              <p className="text-3xl font-semibold text-[#1d1d1f] font-mono tabular-nums">{room.targetTemp.toFixed(1)}℃</p>
                </div>
            </div>

          {/* 详细信息 */}
          <div className="bg-[#f5f5f7] p-4 rounded-xl space-y-3">
            <DetailRow label="风速档位" value={room.speed ?? "--"} />
            <div className="h-px bg-black/[0.04]"></div>
            <DetailRow label="本次费用" value={`¥${room.currentFee.toFixed(2)}`} accent />
            <div className="h-px bg-black/[0.04]"></div>
            <DetailRow label="累计费用" value={`¥${room.totalFee.toFixed(2)}`} accent />
            <div className="h-px bg-black/[0.04]"></div>
            <DetailRow label="服务时长" value={`${room.servedSeconds}s`} />
          </div>
        </div>

        {/* 底部 */}
        <div className="px-6 pb-6">
              <button
            onClick={onClose}
            className="w-full py-3.5 bg-[#0071e3] text-white text-sm font-semibold rounded-xl hover:bg-[#0077ed] active:scale-[0.98] transition-all"
          >
            关闭
                </button>
              </div>
            </div>
          </div>
  );
}

function DetailRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-[#86868b] font-medium">{label}</span>
      <span className={`font-semibold font-mono tabular-nums ${accent ? "text-[#0071e3]" : "text-[#1d1d1f]"}`}>{value}</span>
    </div>
  );
}

// 楼层专属能耗分析面板 - Apple风格
function FloorAnalyticsPanel({ floor, rooms, tempHistory }: { floor: number; rooms: RoomStatus[]; tempHistory?: Array<{ time: Date; temp: number }> }) {
  // 计算楼层统计数据
  const floorStats = useMemo(() => {
    const activeRooms = rooms.filter(r => r.isServing || r.isWaiting);
    const avgTemp = rooms.length > 0 
      ? rooms.reduce((sum, r) => sum + r.currentTemp, 0) / rooms.length 
      : 25;
    const avgTargetTemp = rooms.length > 0
      ? rooms.reduce((sum, r) => sum + r.targetTemp, 0) / rooms.length
      : 25;
    const totalFee = rooms.reduce((sum, r) => sum + r.totalFee, 0);
    const coolingCount = activeRooms.filter(r => r.currentTemp > r.targetTemp).length;
    const heatingCount = activeRooms.filter(r => r.currentTemp < r.targetTemp).length;
    
    return { avgTemp, avgTargetTemp, totalFee, coolingCount, heatingCount, activeCount: activeRooms.length };
  }, [rooms]);

  // 从真实历史数据生成24小时温度趋势（没有数据则默认25度）
  const tempTrendData = useMemo(() => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // 如果有历史数据，使用真实数据
    if (tempHistory && tempHistory.length > 0) {
      // 过滤24小时内的数据
      const recentData = tempHistory.filter(d => d.time >= oneDayAgo);
      
      if (recentData.length > 0) {
        // 生成24个数据点（每小时一个）
        const data = [];
        for (let i = 23; i >= 0; i--) {
          const targetTime = new Date(now.getTime() - i * 60 * 60 * 1000);
          const targetHour = targetTime.getHours();
          
          // 找到该小时内最接近的数据点
          const hourData = recentData.filter(d => {
            const dHour = d.time.getHours();
            return dHour === targetHour || (i === 0 && d.time.getTime() > targetTime.getTime() - 60 * 60 * 1000);
          });
          
          let actual: number | null = null;
          if (hourData.length > 0) {
            // 取该小时内所有数据的平均值
            actual = hourData.reduce((sum, d) => sum + d.temp, 0) / hourData.length;
          } else if (i === 0) {
            // 当前小时，使用最新数据
            const latest = recentData[recentData.length - 1];
            if (latest) actual = latest.temp;
          }
          
          data.push({
            hour: `${targetHour.toString().padStart(2, '0')}:00`,
            actual,
            target: floorStats.avgTargetTemp,
          });
        }
        return data;
      }
    }
    
    // 如果没有数据，返回默认25度的水平线
    const data = [];
    for (let i = 23; i >= 0; i--) {
      const hour = (now.getHours() - i + 24) % 24;
      data.push({
        hour: `${hour.toString().padStart(2, '0')}:00`,
        actual: 25, // 默认25度
        target: floorStats.avgTargetTemp,
      });
    }
    return data;
  }, [tempHistory, floorStats.avgTargetTemp]);

  // 房间能耗排行（按总费用降序）
  const topConsumers = useMemo(() => {
    return [...rooms]
      .filter(r => r.totalFee > 0)
      .sort((a, b) => b.totalFee - a.totalFee)
      .slice(0, 5);
  }, [rooms]);

  const maxFee = topConsumers.length > 0 ? topConsumers[0].totalFee : 1;

  return (
    <div className="mt-3">
      {/* 标题栏 - 与房间状态风格完全一致（在容器外面） */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-base font-semibold text-[#1d1d1f] flex items-center gap-2.5">
          <span className="w-1 h-5 bg-[#34c759] rounded-full"></span>
          {floor}层能耗分析
          <span className="text-xs font-normal text-[#86868b] ml-1">
            Floor {floor} Energy Analysis
          </span>
        </h2>
        <div className="flex items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#34c759]"></span>
            <span className="text-[#86868b]">活跃房间</span>
            <span className="font-semibold text-[#1d1d1f] tabular-nums">{floorStats.activeCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#ff9500]"></span>
            <span className="text-[#86868b]">本层累计</span>
            <span className="font-semibold text-[#34c759] tabular-nums">¥{floorStats.totalFee.toFixed(2)}</span>
          </div>
        </div>
      </div>
      
      {/* 白色容器 - 主内容区 7:3 布局 */}
      <div className="bg-white rounded-2xl shadow-sm border border-black/[0.04] p-5 flex gap-5">
        {/* 左侧区域 (70%) */}
        <div className="flex-[7] min-w-0 flex flex-col gap-4">
          {/* 温度趋势图 */}
          <div className="bg-[#f5f5f7] rounded-xl p-4 border border-black/[0.04]">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-[#1d1d1f]">24小时温度趋势</h4>
              <div className="flex items-center gap-4 text-[10px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#1d1d1f]"></span>
                  <span className="text-[#86868b]">实际温度</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#86868b]"></span>
                  <span className="text-[#86868b]">目标温度</span>
                </span>
              </div>
            </div>
            
            {/* 折线图 */}
            <div className="relative h-[100px]">
              {/* Y轴刻度 */}
              <div className="absolute left-0 top-0 bottom-0 w-7 flex flex-col justify-between text-[9px] text-[#86868b] font-mono pr-1 text-right">
                <span>30°</span>
                <span>25°</span>
                <span>20°</span>
              </div>
              
              {/* 图表区域 */}
              <div className="ml-8 h-full relative bg-white rounded-lg border border-black/[0.04]">
                {/* 网格线 */}
                <div className="absolute inset-2 flex flex-col justify-between pointer-events-none">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="border-b border-dashed border-black/[0.04]"></div>
                  ))}
                </div>
                
                {/* SVG 折线图 */}
                <svg className="w-full h-full p-2" preserveAspectRatio="none" viewBox="0 0 230 80">
                  <defs>
                    <linearGradient id={`tempGradient-${floor}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1d1d1f" stopOpacity="0.15"/>
                      <stop offset="100%" stopColor="#1d1d1f" stopOpacity="0"/>
                    </linearGradient>
                  </defs>
                  
                  {/* 目标温度线 */}
                  <path
                    d={`M 0,${80 - ((floorStats.avgTargetTemp - 20) / 10) * 80} L 230,${80 - ((floorStats.avgTargetTemp - 20) / 10) * 80}`}
                    fill="none"
                    stroke="#86868b"
                    strokeWidth="1.5"
                    strokeDasharray="4,3"
                    opacity="0.6"
                  />
                  
                  {/* 填充区域 */}
                  <path
                    d={`${tempTrendData.map((d, i) => {
                      const x = (i / (tempTrendData.length - 1)) * 230;
                      const actual = d.actual ?? 25; // 没有数据时默认25度
                      const y = 80 - ((actual - 20) / 10) * 80;
                      return `${i === 0 ? 'M' : 'L'} ${x},${Math.max(0, Math.min(80, y))}`;
                    }).join(' ')} L 230,80 L 0,80 Z`}
                    fill={`url(#tempGradient-${floor})`}
                  />
                  
                  {/* 实际温度曲线 */}
                  <path
                    d={tempTrendData.map((d, i) => {
                      const x = (i / (tempTrendData.length - 1)) * 230;
                      const actual = d.actual ?? 25; // 没有数据时默认25度
                      const y = 80 - ((actual - 20) / 10) * 80;
                      return `${i === 0 ? 'M' : 'L'} ${x},${Math.max(0, Math.min(80, y))}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#1d1d1f"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              
              {/* X轴时间标签 */}
              <div className="ml-8 flex justify-between text-[9px] text-[#86868b] font-mono mt-1">
                <span>24h前</span>
                <span>12h前</span>
                <span>现在</span>
              </div>
            </div>
          </div>
          
          {/* 底部统计卡片 - Apple风格 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#f5f5f7] rounded-xl p-3 border border-black/[0.04] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#0071e3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-[#86868b]">平均温度</p>
                <p className="text-lg font-bold text-[#1d1d1f] font-mono">{floorStats.avgTemp.toFixed(1)}°</p>
              </div>
            </div>
            <div className="bg-[#f5f5f7] rounded-xl p-3 border border-black/[0.04] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#ff9500]/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#ff9500]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-[#86868b]">目标温度</p>
                <p className="text-lg font-bold text-[#1d1d1f] font-mono">{floorStats.avgTargetTemp.toFixed(1)}°</p>
              </div>
            </div>
            <div className="bg-[#f5f5f7] rounded-xl p-3 border border-black/[0.04] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#34c759]/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-[#34c759]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-[#86868b]">温度差异</p>
                <p className="text-lg font-bold text-[#1d1d1f] font-mono">{Math.abs(floorStats.avgTemp - floorStats.avgTargetTemp).toFixed(1)}°</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* 右侧区域 (30%) - 能耗排行榜 + 模式分布 合并 */}
        <div className="flex-[3] min-w-0 bg-[#f5f5f7] rounded-xl p-4 border border-black/[0.04] flex flex-col">
          {/* 能耗排行榜 */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-[#1d1d1f]">能耗排行榜</h4>
              <span className="text-[9px] text-[#86868b] bg-white px-2 py-0.5 rounded-md">TOP 5</span>
            </div>
            
            {topConsumers.length === 0 ? (
              <div className="h-[120px] flex items-center justify-center text-[#86868b] text-xs">
                暂无能耗数据
              </div>
            ) : (
              <div className="space-y-2">
                {topConsumers.map((room, index) => (
                  <div key={room.roomId} className="flex items-center gap-2">
                    <div className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                      index === 0 ? 'bg-[#ff9500]/20 text-[#ff9500]' :
                      index === 1 ? 'bg-[#86868b]/10 text-[#86868b]' :
                      index === 2 ? 'bg-[#ff9500]/10 text-[#ff9500]' :
                      'bg-[#f5f5f7] text-[#86868b]'
                    }`}>
                      {index + 1}
                    </div>
                    <span className="text-[11px] font-semibold text-[#1d1d1f] w-8">{room.roomId}</span>
                    <div className="flex-1 h-4 bg-white rounded-md overflow-hidden relative border border-black/[0.04]">
                      <div 
                        className={`h-full transition-all duration-500 ${
                          index === 0 ? 'bg-[#ff9500]' :
                          index === 1 ? 'bg-[#86868b]' :
                          'bg-[#0071e3]'
                        }`}
                        style={{ width: `${(room.totalFee / maxFee) * 100}%` }}
                      />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold text-[#1d1d1f] font-mono">
                        ¥{room.totalFee.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
        </div>
      )}
          </div>
          
          {/* 分隔线 */}
          <div className="my-3 border-t border-black/[0.04]"></div>
          
          {/* 运行模式分布 */}
          <div>
            <h4 className="text-xs font-semibold text-[#1d1d1f] mb-2">运行模式分布</h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white rounded-lg p-2 border border-black/[0.04] text-center">
                <div className="w-3 h-3 rounded bg-[#0071e3] mx-auto mb-1"></div>
                <p className="text-sm font-bold text-[#1d1d1f]">{floorStats.coolingCount}</p>
                <p className="text-[9px] text-[#86868b]">制冷</p>
              </div>
              <div className="bg-white rounded-lg p-2 border border-black/[0.04] text-center">
                <div className="w-3 h-3 rounded bg-[#ff3b30] mx-auto mb-1"></div>
                <p className="text-sm font-bold text-[#1d1d1f]">{floorStats.heatingCount}</p>
                <p className="text-[9px] text-[#86868b]">制热</p>
              </div>
              <div className="bg-white rounded-lg p-2 border border-black/[0.04] text-center">
                <div className="w-3 h-3 rounded bg-[#c7c7cc] mx-auto mb-1"></div>
                <p className="text-sm font-bold text-[#1d1d1f]">{rooms.length - floorStats.activeCount}</p>
                <p className="text-[9px] text-[#86868b]">空闲</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
