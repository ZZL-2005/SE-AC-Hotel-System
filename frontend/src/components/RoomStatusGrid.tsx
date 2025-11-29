import { useEffect, useRef } from "react";
import type { RoomStatus } from "../types/rooms";

type RoomStatusGridProps = {
  rooms: RoomStatus[];
  onRoomClick?: (room: RoomStatus) => void;
  highlightedRoomId?: string | null;
};

// 风速图标组件
type SpeedIconProps = {
  speed: string | null | undefined;
};

function SpeedIcon({ speed }: SpeedIconProps) {
  const getActiveCount = () => {
    switch (speed) {
      case "HIGH":
      case "高":
        return 3;
      case "MID":
      case "中":
        return 2;
      case "LOW":
      case "低":
        return 1;
      default:
        return 0;
    }
  };

  const activeCount = getActiveCount();
  const heights = [5, 8, 12];

  return (
    <div className="flex items-end gap-[2px]">
      {heights.map((height, index) => {
        const isActive = index < activeCount;
        return (
          <div
            key={index}
            className="w-[4px] rounded-sm"
            style={{
              height: `${height}px`,
              backgroundColor: isActive ? "#0071e3" : "#d1d1d6",
              transition: "all 0.2s ease",
            }}
          />
        );
      })}
    </div>
  );
}

// 专业图标组件 - 雪花（制冷）
function SnowflakeIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
      <path d="M12 2v4m0 12v4m-5.66-3.66l2.83-2.83m5.66-5.66l2.83-2.83M2 12h4m12 0h4M6.34 6.34l2.83 2.83m5.66 5.66l2.83 2.83M6.34 17.66l2.83-2.83m5.66-5.66l2.83-2.83" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

// 专业图标组件 - 火焰（制热）
function FlameIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
      <path d="M12 2c1.5 2 2.5 4.5 2.5 6.5 0 1.5-.5 3-2 4 1-1 1.5-2 1.5-3.5 0-1.5-1-3.5-2-5C10.5 6 9.5 8 9.5 9.5c0 1.5.5 2.5 1.5 3.5-1.5-1-2-2.5-2-4 0-2 1-4.5 2.5-6.5-.5 1.5-.5 3 0 4.5 0 0 1-2 1-2.5.5.5.5 1.5.5 2v.5c.5-.5.5-1.5 1-2 0 2-1 3.5-2 4.5v.5c2 1 3 3 3 5.5 0 3-2.5 5.5-5.5 5.5S6 18.5 6 15.5c0-2.5 1-4.5 3-5.5v-.5c-1-1-2-2.5-2-4.5.5.5.5 1.5 1 2V7c0-.5 0-1.5.5-2 0 .5 1 2.5 1 2.5.5-1.5.5-3 0-4.5z"/>
    </svg>
  );
}

// 专业图标组件 - 计时器
function TimerIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" width="10" height="10">
      <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
    </svg>
  );
}

// 现代化卡片配置 - Apple风格
const statusConfig: Record<string, { accent: string; bg: string; accentBg: string }> = {
  idle: {
    accent: "bg-[#d1d1d6]",
    bg: "bg-white",
    accentBg: "bg-[#f5f5f7]",
  },
  running: {
    accent: "bg-gradient-to-b from-[#0071e3] to-[#0077ed]",
    bg: "bg-white",
    accentBg: "bg-gradient-to-r from-[#e5f1fc] to-white",
  },
  paused: {
    accent: "bg-gradient-to-b from-[#ff9500] to-[#ff9f0a]",
    bg: "bg-white",
    accentBg: "bg-gradient-to-r from-[#fff5e5] to-white",
  },
  off: {
    accent: "bg-[#86868b]",
    bg: "bg-white",
    accentBg: "bg-[#f5f5f7]",
  },
};

function getTempColor(currentTemp: number, targetTemp: number, isActive: boolean, isWaiting: boolean): { text: string; bg: string } {
  if (!isActive) {
    return { text: "text-[#86868b]", bg: "bg-[#f5f5f7]" };
  }
  
  // 等待状态：柔和橙色
  if (isWaiting) {
    return { text: "text-[#c45500]", bg: "bg-gradient-to-r from-[#fff5e5] to-[#fffaf0]" };
  }
  
  // 根据当前温度与目标温度比较判断制冷/制热
  if (currentTemp > targetTemp) {
    // 制冷模式：Apple蓝色
    return { text: "text-[#0071e3]", bg: "bg-gradient-to-r from-[#e5f1fc] to-[#f0f7ff]" };
  } else {
    // 制热模式：Apple红色
    return { text: "text-[#ff3b30]", bg: "bg-gradient-to-r from-[#ffe5e5] to-[#fff0f0]" };
  }
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h${mins}m${secs}s`;
  if (mins > 0) return `${mins}m${secs}s`;
  return `${secs}s`;
}

export function RoomStatusGrid({ rooms, onRoomClick, highlightedRoomId }: RoomStatusGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const roomRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 当有高亮房间时，滚动到该房间
  useEffect(() => {
    if (highlightedRoomId && roomRefs.current[highlightedRoomId] && containerRef.current) {
      roomRefs.current[highlightedRoomId]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [highlightedRoomId]);

  if (rooms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-[#f5f5f7] to-[#e8e8ed] rounded-2xl flex items-center justify-center mb-3 shadow-inner">
          <svg className="w-8 h-8 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
        <p className="text-[#1d1d1f] text-sm font-medium">暂无房间数据</p>
        <p className="text-[#86868b] text-xs mt-1">请等待数据加载或入住房间</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="grid grid-cols-5 gap-2.5">
      {rooms.map((room) => {
        const isHighlighted = highlightedRoomId === room.roomId;
        const config = statusConfig[room.status] || statusConfig.idle;
        const isServing = room.isServing;
        const isWaiting = room.isWaiting;
        const isActive = isServing || isWaiting || room.status === "running";
        // 直接使用后端返回的温度值（如果为null/undefined则使用默认值25）
        const currentTemp = room.currentTemp ?? 25;
        const targetTemp = room.targetTemp ?? 25;
        const tempColor = getTempColor(currentTemp, targetTemp, isActive, isWaiting);

        return (
          <div
            key={room.roomId}
            ref={(el) => { roomRefs.current[room.roomId] = el; }}
            onClick={() => onRoomClick?.(room)}
            className={`
              group relative cursor-pointer overflow-hidden rounded-xl
              ${config.bg}
              shadow-[0_2px_12px_rgba(0,0,0,0.04)]
              hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]
              hover:-translate-y-0.5
              transition-all duration-300 ease-out
              border border-black/[0.04]
              ${isServing ? "shadow-[0_4px_20px_rgba(0,113,227,0.15)]" : ""}
              ${isWaiting ? "shadow-[0_4px_20px_rgba(255,149,0,0.12)]" : ""}
              ${isHighlighted ? "ring-2 ring-[#0071e3] shadow-[0_8px_30px_rgba(0,113,227,0.2)] scale-[1.02] z-10" : ""}
            `}
          >
            {/* 左侧状态指示条 */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${
              isServing ? "bg-gradient-to-b from-[#0071e3] to-[#0077ed]" 
              : isWaiting ? "bg-gradient-to-b from-[#ff9500] to-[#ff9f0a]"
              : config.accent
            }`}></div>

            {/* 头部区域 */}
            <div className={`${config.accentBg} px-3 py-2 flex items-center justify-between border-b border-black/[0.04]`}>
                  <div className="flex items-center gap-2">
                <span className={`text-base font-semibold tabular-nums ${
                  isServing ? "text-[#0071e3]" : isWaiting ? "text-[#c45500]" : "text-[#1d1d1f]"
                }`}>
                  {room.roomId}
                </span>
                {isActive && (
                  <span className={currentTemp > targetTemp ? "text-[#0071e3]" : "text-[#ff3b30]"}>
                    {currentTemp > targetTemp ? <SnowflakeIcon /> : <FlameIcon />}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {isServing && (
                  <span className="text-[10px] text-[#0071e3] font-medium bg-[#e5f1fc] px-1.5 py-0.5 rounded-md flex items-center gap-1">
                    <TimerIcon className="text-[#0071e3]" /> {formatDuration(room.servedSeconds || 0)}
                  </span>
                )}
                {isServing ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#1d1d1f] text-white font-semibold">
                    服务中
                  </span>
                ) : isWaiting ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#ff9500] text-white font-medium">
                    等待
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#f5f5f7] text-[#86868b] font-medium">
                    空闲
                  </span>
                )}
              </div>
            </div>

            {/* 内容区 */}
            <div className="p-3">
              {/* 温度显示 - 更通透 */}
              <div className={`${tempColor.bg} p-2.5 rounded-lg mb-3`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`${isActive ? "text-2xl" : "text-xl"} font-semibold font-mono tabular-nums ${tempColor.text}`}>
                      {currentTemp.toFixed(1)}°
                    </span>
                    {isActive && (
                      <div className="flex items-center">
                        <SpeedIcon speed={room.speed} />
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] font-medium text-[#86868b] block mb-0.5">目标</span>
                    <span className="text-sm font-semibold text-[#1d1d1f] font-mono tabular-nums">{targetTemp.toFixed(1)}°</span>
                  </div>
                </div>
              </div>

              {/* 底部信息：费用 - 更清晰的层次 */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 text-center">
                  <span className="text-[9px] font-medium text-[#86868b] block mb-0.5">本次</span>
                  <span className="text-[13px] font-semibold text-[#1d1d1f] font-mono tabular-nums">
                    ¥{room.currentFee.toFixed(2)}
                  </span>
                </div>
                <div className="w-px h-6 bg-[#d1d1d6]"></div>
                <div className="flex-1 text-center">
                  <span className="text-[9px] font-medium text-[#86868b] block mb-0.5">累计</span>
                  <span className="text-[13px] font-semibold text-[#1d1d1f] font-mono tabular-nums">
                    ¥{room.totalFee.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
