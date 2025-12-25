import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { monitorClient } from "../api/monitorClient";
import { acClient } from "../api/acClient";
import { frontdeskClient } from "../api/frontdeskClient";
import { debugClient, type TimerDetail, type SystemStatus } from "../api/debugClient";
import type { RoomStatus } from "../types/rooms";

interface QueueItem {
  roomId: string;
  speed: string;
  status: string;
  servedSeconds?: number;
  waitedSeconds?: number;
  priorityToken: number;
  timeSliceEnforced: boolean;
  timerId: string;
}

export function DebugAdminPage() {
  const { selectedRoomId, setSelectedRoomId } = useAuth();
  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const allRooms = useMemo(() => {
    const occupied = new Set(rooms.map((r) => r.roomId));
    return Array.from({ length: 100 }, (_, idx) => {
      const roomId = String(idx + 1);
      return { roomId, status: occupied.has(roomId) ? "occupied" : "available" };
    });
  }, [rooms]);
  const [selectedRoom, setSelectedRoom] = useState<RoomStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  // 空调控制状态
  const [targetTemp, setTargetTemp] = useState(24);
  const [speed, setSpeed] = useState("MID");
  
  // 用于保持滑动条状态，避免数据更新时重置
  const tempSliderRef = useRef<HTMLInputElement>(null);
  const isAdjustingTemp = useRef(false);
  const hasManuallyChangedTemp = useRef(false); // 标记用户是否手动修改过温度
  
  // 直接调节
  const [manualTemp, setManualTemp] = useState("");
  const [manualFee, setManualFee] = useState("");
  
  // TimeManager 状态
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [timerDetails, setTimerDetails] = useState<TimerDetail[]>([]);
  // 新增队列状态状态变量
  const [queueStatus, setQueueStatus] = useState<{ serviceQueue: QueueItem[], waitingQueue: QueueItem[] }>({ serviceQueue: [], waitingQueue: [] });
  
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    roomId: string;
  } | null>(null);

  // 加载房间列表
  const loadRooms = useCallback(async () => {
    const { data } = await monitorClient.fetchRooms();
    if (data?.rooms) {
      setRooms(data.rooms);
      if (selectedRoomId) {
        const room = data.rooms.find(r => r.roomId === selectedRoomId);
        if (room) {
          setSelectedRoom(room);
          // 只有当用户不在调节温度且未手动修改过温度时才更新滑动条
          if (!isAdjustingTemp.current && !hasManuallyChangedTemp.current) {
            setTargetTemp(room.targetTemp || 24);
          }
        }
      }
    }
  }, [selectedRoomId]);

  // 加载 TimeManager 状态
  const loadSystemStatus = useCallback(async () => {
    const { data } = await debugClient.getSystemStatus();
    if (data) {
      setSystemStatus(data);
    }
  }, []);

  // 加载计时器详情
  const loadTimers = useCallback(async () => {
    try {
      const { data, error } = await debugClient.getTimerDetails();
      if (error) {
        console.error("[Debug] Failed to load timer details:", error);
        return;
      }
      setTimerDetails(data?.timers || []);
    } catch (err) {
      console.error("[Debug] Error loading timer details:", err);
    }
  }, []);

  // 新增加载队列状态的函数
  const loadQueueStatus = useCallback(async () => {
    try {
      const { data, error } = await debugClient.getQueueStatus();
      if (error) {
        console.error("[Debug] Failed to load queue status:", error);
        return;
      }
      setQueueStatus(data || { serviceQueue: [], waitingQueue: [] });
    } catch (err) {
      console.error("[Debug] Error loading queue status:", err);
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      loadTimers();
      loadQueueStatus(); // 定时加载队列状态
      loadRooms();
      loadSystemStatus();
    }, 1000);

    return () => window.clearInterval(interval);
  }, [loadRooms, loadSystemStatus, loadTimers, loadQueueStatus]);

  const handleRoomSelect = (roomId: string) => {
    setSelectedRoomId(roomId);
    const room = rooms.find(r => r.roomId === roomId);
    if (room) {
      setSelectedRoom(room);
      // 切换房间时重置温度并清除手动修改标记
      setTargetTemp(room.targetTemp || 24);
      hasManuallyChangedTemp.current = false;
    }
  };

  // 处理右键菜单
  const handleContextMenu = (e: React.MouseEvent, roomId: string, isOccupied: boolean) => {
    e.preventDefault();
    // 只对未入住的房间显示右键菜单
    if (!isOccupied) {
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        roomId,
      });
    }
  };

  // 关闭右键菜单
  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // 快捷入住
  const handleQuickCheckin = async (roomId: string) => {
    closeContextMenu();
    try {
      const { error } = await frontdeskClient.checkIn({
        custId: `DBG${Date.now()}`,
        custName: `调试用户-${roomId}`,
        guestCount: 1,
        checkInDate: new Date().toISOString(),
        roomId: roomId,
        deposit: 0,
      });
      if (error) {
        setMessage(`❌ 入住失败: ${error}`);
      } else {
        setMessage(`✅ 房间 ${roomId} 入住成功`);
        loadRooms();
      }
    } catch (err) {
      setMessage(`❌ 入住失败: ${err}`);
    }
  };

  // 空调控制
  // 点击其他地方关闭右键菜单
  useEffect(() => {
    const handleClick = () => closeContextMenu();
    if (contextMenu?.visible) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  const handlePowerOn = async () => {
    if (!selectedRoomId) return;
    const { error } = await acClient.powerOn(selectedRoomId);
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 开机成功");
    loadRooms();
  };

  const handlePowerOff = async () => {
    if (!selectedRoomId) return;
    const { error } = await acClient.powerOff(selectedRoomId);
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 关机成功");
    loadRooms();
  };

  const handleChangeTemp = async () => {
    if (!selectedRoomId) return;
    const { error } = await acClient.changeTemp(selectedRoomId, targetTemp);
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 温度已调节");
    // 温度调节成功后清除手动修改标记，允许后续更新
    hasManuallyChangedTemp.current = false;
    loadRooms();
  };

  const handleChangeSpeed = async () => {
    if (!selectedRoomId) return;
    const { error } = await acClient.changeSpeed(selectedRoomId, speed);
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 风速已调节");
    loadRooms();
  };

  // 直接调节温度
  const handleSetTemperature = async () => {
    if (!selectedRoomId || !manualTemp) return;
    const { error } = await debugClient.setTemperature({
      roomId: selectedRoomId,
      temperature: parseFloat(manualTemp),
    });
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 温度已直接设置");
    setManualTemp("");
    loadRooms();
  };

  // 直接调节费用
  const handleSetFee = async () => {
    if (!selectedRoomId || !manualFee) return;
    const fee = parseFloat(manualFee);
    const { error } = await debugClient.setFee({
      roomId: selectedRoomId,
      currentFee: fee,
      totalFee: fee,
    });
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 费用已直接设置");
    setManualFee("");
    loadRooms();
  };

  // 暂停系统
  const handlePauseSystem = async () => {
    const { error } = await debugClient.pauseSystem();
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 系统已暂停");
    loadSystemStatus();
  };

  // 恢复系统
  const handleResumeSystem = async () => {
    const { error } = await debugClient.resumeSystem();
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 系统已恢复");
    loadSystemStatus();
  };

  return (
    <div className="h-screen bg-[#1e1e1e] text-[#d4d4d4] flex flex-col">
      {/* 顶部栏 */}
      <div className="bg-[#252526] px-4 py-3 flex items-center justify-between border-b border-[#3e3e42]">
        <div className="flex items-center gap-3">
          <span className="text-lg">🛠️</span>
          <h1 className="text-sm font-medium">调试管理员</h1>
          {selectedRoomId && (
            <span className="text-xs text-[#858585]">
              当前房间: <span className="text-[#4ec9b0]">{selectedRoomId}</span>
            </span>
          )}
        </div>
        {message && (
          <div className="text-xs bg-[#3e3e42] px-3 py-1 rounded">{message}</div>
        )}
      </div>

      {/* 主内容区 - 三栏布局 */}
      <div className="flex-1 flex overflow-hidden" onClick={closeContextMenu}>
        {/* 左侧：房间选择器 */}
        <div className="w-64 bg-[#252526] border-r border-[#3e3e42] flex flex-col">
          <div className="px-3 py-2 text-xs font-medium border-b border-[#3e3e42] flex items-center justify-between">
            <span>全部房间</span>
            <span className="text-[#858585]">{allRooms.filter(r => r.status === 'occupied').length}/100</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {allRooms.map((room) => {
              const occupiedRoom = rooms.find(r => r.roomId === room.roomId);
              const isOccupied = room.status === 'occupied';
              
              return (
                <button
                  key={room.roomId}
                  onClick={() => isOccupied && handleRoomSelect(room.roomId)}
                  onContextMenu={(e) => handleContextMenu(e, room.roomId, isOccupied)}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-[#2a2d2e] ${
                    selectedRoomId === room.roomId ? "bg-[#37373d]" : ""
                  } ${
                    !isOccupied ? "opacity-40" : ""
                  }`}
                  disabled={!isOccupied}
                >
                  <span>{room.roomId}</span>
                  {isOccupied && occupiedRoom ? (
                    <span
                      className={`w-2 h-2 rounded-full ${
                        occupiedRoom.isServing ? "bg-[#4ec9b0]" : occupiedRoom.isWaiting ? "bg-[#ce9178]" : "bg-[#858585]"
                      }`}
                    />
                  ) : (
                    <span className="text-[10px] text-[#858585]">未入住</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 中间：控制面板 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 空调控制 */}
          <div className="bg-[#252526] rounded p-4 space-y-3">
            <h3 className="text-sm font-medium mb-2">空调控制</h3>
            <div className="flex gap-2">
              <button
                onClick={handlePowerOn}
                className="flex-1 bg-[#0e639c] hover:bg-[#1177bb] px-3 py-2 rounded text-xs"
                disabled={!selectedRoomId}
              >
                开机
              </button>
              <button
                onClick={handlePowerOff}
                className="flex-1 bg-[#3e3e42] hover:bg-[#505050] px-3 py-2 rounded text-xs"
                disabled={!selectedRoomId}
              >
                关机
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#858585]">目标温度: {targetTemp}°C</label>
              <input
                ref={tempSliderRef}
                type="range"
                min="16"
                max="30"
                value={targetTemp}
                onChange={(e) => {
                  setTargetTemp(Number(e.target.value));
                  hasManuallyChangedTemp.current = true; // 标记用户已手动修改
                }}
                onMouseDown={() => { isAdjustingTemp.current = true; }}
                onMouseUp={() => { isAdjustingTemp.current = false; }}
                onTouchStart={() => { isAdjustingTemp.current = true; }}
                onTouchEnd={() => { isAdjustingTemp.current = false; }}
                className="w-full"
              />
              <button
                onClick={handleChangeTemp}
                className="w-full bg-[#0e639c] hover:bg-[#1177bb] px-3 py-2 rounded text-xs"
                disabled={!selectedRoomId}
              >
                调节温度
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#858585]">风速</label>
              <select
                value={speed}
                onChange={(e) => setSpeed(e.target.value)}
                className="w-full bg-[#3c3c3c] border border-[#3e3e42] rounded px-2 py-1 text-xs"
              >
                <option value="HIGH">高风</option>
                <option value="MID">中风</option>
                <option value="LOW">低风</option>
              </select>
              <button
                onClick={handleChangeSpeed}
                className="w-full bg-[#0e639c] hover:bg-[#1177bb] px-3 py-2 rounded text-xs"
                disabled={!selectedRoomId}
              >
                调节风速
              </button>
            </div>
          </div>

          {/* 服务队列 */}
          <div className="bg-[#252526] rounded p-4 space-y-3">
            <h3 className="text-sm font-medium mb-2">🔵 服务队列</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {queueStatus.serviceQueue.length === 0 ? (
                <div className="text-xs text-[#858585] text-center py-2">队列为空</div>
              ) : (
                queueStatus.serviceQueue.map((service) => (
                  <div key={service.roomId} className="bg-[#1e1e1e] rounded p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#4ec9b0]">房间 {service.roomId}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#4ec9b0] text-black">
                        {service.speed}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[#858585]">服务时长:</span>
                        <span className="ml-2 font-mono text-[#dcdcaa]">{Math.floor((service.servedSeconds || 0) / 60)}分{(service.servedSeconds || 0) % 60}秒</span>
                      </div>
                      <div>
                        <span className="text-[#858585]">优先级:</span>
                        <span className="ml-2 font-mono text-[#ce9178]">{service.priorityToken}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 等待队列 */}
          <div className="bg-[#252526] rounded p-4 space-y-3">
            <h3 className="text-sm font-medium mb-2">🟡 等待队列</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {queueStatus.waitingQueue.length === 0 ? (
                <div className="text-xs text-[#858585] text-center py-2">队列为空</div>
              ) : (
                queueStatus.waitingQueue.map((wait) => (
                  <div key={wait.roomId} className="bg-[#1e1e1e] rounded p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#ce9178]">房间 {wait.roomId}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#ce9178] text-black">
                        {wait.speed}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[#858585]">已等待:</span>
                        <span className="ml-2 font-mono text-[#dcdcaa]">{Math.floor((wait.waitedSeconds || 0) / 60)}分{(wait.waitedSeconds || 0) % 60}秒</span>
                      </div>
                      <div>
                        <span className="text-[#858585]">优先级:</span>
                        <span className="ml-2 font-mono text-[#ce9178]">{wait.priorityToken}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 危险区域：直接调节 */}
          <div className="bg-[#3e1e1e] border border-[#be1100] rounded p-4 space-y-3">
            <h3 className="text-sm font-medium mb-2 text-[#f48771]">⚠️ 危险操作</h3>
            <div className="space-y-2">
              <label className="text-xs text-[#858585]">直接设置温度</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="温度 (°C)"
                  value={manualTemp}
                  onChange={(e) => setManualTemp(e.target.value)}
                  className="flex-1 bg-[#3c3c3c] border border-[#3e3e42] rounded px-2 py-1 text-xs"
                  step="0.1"
                />
                <button
                  onClick={handleSetTemperature}
                  className="bg-[#be1100] hover:bg-[#d13f25] px-3 py-1 rounded text-xs"
                  disabled={!selectedRoomId || !manualTemp}
                >
                  设置
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#858585]">直接设置费用</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="费用 (¥)"
                  value={manualFee}
                  onChange={(e) => setManualFee(e.target.value)}
                  className="flex-1 bg-[#3c3c3c] border border-[#3e3e42] rounded px-2 py-1 text-xs"
                  step="0.01"
                />
                <button
                  onClick={handleSetFee}
                  className="bg-[#be1100] hover:bg-[#d13f25] px-3 py-1 rounded text-xs"
                  disabled={!selectedRoomId || !manualFee}
                >
                  设置
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：状态监控 */}
        <div className="w-96 bg-[#252526] border-l border-[#3e3e42] p-4 space-y-4 overflow-y-auto">
          {/* TimeManager 状态 */}
          <div className="bg-[#1e1e1e] rounded p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-[#858585]">⏱️ TimeManager 状态</h3>
              {systemStatus && (
                <span className={`text-[10px] px-2 py-0.5 rounded ${
                  systemStatus.paused 
                    ? "bg-[#be1100] text-white" 
                    : "bg-[#4ec9b0] text-black"
                }`}>
                  {systemStatus.paused ? "⏸️ 已暂停" : "▶️ 运行中"}
                </span>
              )}
            </div>
            
            {systemStatus && (
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Tick 计数:</span>
                  <span className="text-[#4ec9b0] font-mono">{systemStatus.tick}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tick 间隔:</span>
                  <span className="text-[#dcdcaa] font-mono">{systemStatus.tickInterval.toFixed(3)}s</span>
                </div>
                <div className="flex justify-between">
                  <span>总计时器:</span>
                  <span className="text-[#ce9178]">{systemStatus.timerStats.totalTimers}</span>
                </div>
                {systemStatus.timerStats.byType && Object.entries(systemStatus.timerStats.byType).map(([type, count]) => (
                  <div key={type} className="flex justify-between pl-4 text-[11px]">
                    <span className="text-[#858585]">{type}:</span>
                    <span>{count}</span>
                  </div>
                ))}
              </div>
            )}
            
            {/* 系统控制按钮 */}
            <div className="pt-2 border-t border-[#3e3e42] flex gap-2">
              {systemStatus?.paused ? (
                <button
                  onClick={handleResumeSystem}
                  className="flex-1 bg-[#4ec9b0] hover:bg-[#5ed9c0] text-black px-3 py-1.5 rounded text-xs font-medium"
                >
                  ▶️ 恢复系统
                </button>
              ) : (
                <button
                  onClick={handlePauseSystem}
                  className="flex-1 bg-[#be1100] hover:bg-[#d13f25] px-3 py-1.5 rounded text-xs font-medium"
                >
                  ⏸️ 暂停系统
                </button>
              )}
            </div>
          </div>

          {/* 计时器详情 */}
          <div className="bg-[#1e1e1e] rounded p-3 space-y-2">
            <h3 className="text-xs font-medium text-[#858585]">🗒️ 计时器详情 ({timerDetails.length})</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {timerDetails.length === 0 ? (
                <div className="text-xs text-[#858585] text-center py-2">暂无计时器</div>
              ) : (
                timerDetails.map((timer) => (
                  <div key={timer.timer_id} className="bg-[#252526] rounded p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-[#4ec9b0]">{timer.room_id}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        timer.type === 'SERVICE' ? 'bg-[#4ec9b0] text-black' :
                        timer.type === 'WAIT' ? 'bg-[#ce9178] text-black' :
                        timer.type === 'DETAIL' ? 'bg-[#dcdcaa] text-black' :
                        'bg-[#858585] text-white'
                      }`}>
                        {timer.type}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      {timer.speed && (
                        <>
                          <span className="text-[#858585]">风速:</span>
                          <span>{timer.speed}</span>
                        </>
                      )}
                      <span className="text-[#858585]">已过:</span>
                      <span className="font-mono">{timer.elapsed}s</span>
                      {timer.remaining > 0 && (
                        <>
                          <span className="text-[#858585]">剩余:</span>
                          <span className="font-mono">{timer.remaining}s</span>
                        </>
                      )}
                      {timer.fee > 0 && (
                        <>
                          <span className="text-[#858585]">费用:</span>
                          <span className="font-mono text-[#dcdcaa]">¥{timer.fee.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 房间状态 */}
          {selectedRoom && (
            <>
              <div className="bg-[#1e1e1e] rounded p-3 space-y-2">
                <h3 className="text-xs font-medium text-[#858585]">房间状态</h3>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span>房间号:</span>
                    <span className="text-[#4ec9b0]">{selectedRoom.roomId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>当前温度:</span>
                    <span className="text-[#ce9178]">{selectedRoom.currentTemp.toFixed(1)}°C</span>
                  </div>
                  <div className="flex justify-between">
                    <span>目标温度:</span>
                    <span>{selectedRoom.targetTemp.toFixed(1)}°C</span>
                  </div>
                  <div className="flex justify-between">
                    <span>风速:</span>
                    <span>{selectedRoom.speed || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>服务状态:</span>
                    <span className={selectedRoom.isServing ? "text-[#4ec9b0]" : ""}>
                      {selectedRoom.isServing ? "服务中" : selectedRoom.isWaiting ? "等待中" : "空闲"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>本次费用:</span>
                    <span className="text-[#dcdcaa]">¥{selectedRoom.currentFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>累计费用:</span>
                    <span className="text-[#dcdcaa]">¥{selectedRoom.totalFee.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 右键菜单 */}
      {contextMenu?.visible && (
        <div
          className="fixed bg-[#252526] border border-[#3e3e42] rounded shadow-lg py-1 z-50"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleQuickCheckin(contextMenu.roomId)}
            className="w-full px-4 py-2 text-xs text-left hover:bg-[#2a2d2e] flex items-center gap-2"
          >
            <span>🚪</span>
            <span>办理入住</span>
          </button>
        </div>
      )}
    </div>
  );
}
