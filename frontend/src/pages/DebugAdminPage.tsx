import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { monitorClient } from "../api/monitorClient";
import { acClient } from "../api/acClient";
import { frontdeskClient } from "../api/frontdeskClient";
import { debugClient } from "../api/debugClient";
import { adminClient } from "../api/adminClient";
import type { RoomStatus } from "../types/rooms";

export function DebugAdminPage() {
  const { selectedRoomId, setSelectedRoomId } = useAuth();
  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const [allRooms, setAllRooms] = useState<Array<{roomId: string, status: string}>>([]);
  const [selectedRoom, setSelectedRoom] = useState<RoomStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  // 空调控制状态
  const [targetTemp, setTargetTemp] = useState(24);
  const [speed, setSpeed] = useState("MID");
  
  // 快捷入住表单
  const [custName, setCustName] = useState("");
  
  // 批量入住
  const [batchRoomIds, setBatchRoomIds] = useState("");
  
  // 直接调节
  const [manualTemp, setManualTemp] = useState("");
  const [manualFee, setManualFee] = useState("");

  // 加载房间列表
  const loadRooms = useCallback(async () => {
    const { data } = await monitorClient.fetchRooms();
    if (data?.rooms) {
      setRooms(data.rooms);
      if (selectedRoomId) {
        const room = data.rooms.find(r => r.roomId === selectedRoomId);
        if (room) {
          setSelectedRoom(room);
          setTargetTemp(room.targetTemp || 24);
        }
      }
    }
  }, [selectedRoomId]);

  // 加载所有房间（包括未开放的）
  const loadAllRooms = useCallback(async () => {
    // 生成1-100的房间号
    const roomList = [];
    for (let i = 1; i <= 100; i++) {
      const roomId = String(i);
      const isOccupied = rooms.some(r => r.roomId === roomId);
      roomList.push({ roomId, status: isOccupied ? 'occupied' : 'available' });
    }
    setAllRooms(roomList);
  }, [rooms]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    loadAllRooms();
  }, [loadAllRooms]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadRooms();
    }, 2000);
    return () => clearInterval(interval);
  }, [loadRooms]);

  const handleRoomSelect = (roomId: string) => {
    setSelectedRoomId(roomId);
    const room = rooms.find(r => r.roomId === roomId);
    if (room) {
      setSelectedRoom(room);
      setTargetTemp(room.targetTemp || 24);
    }
  };

  // 空调控制
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
    loadRooms();
  };

  const handleChangeSpeed = async () => {
    if (!selectedRoomId) return;
    const { error } = await acClient.changeSpeed(selectedRoomId, speed);
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 风速已调节");
    loadRooms();
  };

  // 快捷入住
  const handleQuickCheckin = async () => {
    if (!selectedRoomId) return;
    const { error } = await frontdeskClient.checkIn({
      custId: `DBG${Date.now()}`,
      custName: custName || "调试用户",
      guestCount: 1,
      checkInDate: new Date().toISOString(),
      roomId: selectedRoomId,
      deposit: 0,
    });
    if (error) setMessage(`❌ ${error}`);
    else setMessage("✅ 快捷入住成功");
    setCustName("");
    loadRooms();
  };

  // 批量入住
  const handleBatchCheckin = async () => {
    if (!batchRoomIds.trim()) return;
    
    const roomIds = batchRoomIds.split(/[,\s]+/).filter(id => id.trim());
    if (roomIds.length === 0) {
      setMessage("❌ 请输入有效的房间号");
      return;
    }
    
    try {
      const { error } = await debugClient.batchCheckin({ roomIds });
      if (error) {
        setMessage(`❌ ${error}`);
      } else {
        setMessage(`✅ 批量入住成功: ${roomIds.length} 个房间`);
        setBatchRoomIds("");
        // 重新加载房间状态
        loadRooms();
      }
    } catch (err) {
      setMessage(`❌ 批量入住失败: ${err}`);
    }
  };

  // 快捷批量入住
  const handleQuickBatchCheckin = async (start: number, end: number) => {
    const roomIds = [];
    for (let i = start; i <= end; i++) {
      roomIds.push(String(i));
    }
    
    try {
      const { error } = await debugClient.batchCheckin({ roomIds });
      if (error) {
        setMessage(`❌ ${error}`);
      } else {
        setMessage(`✅ 批量入住成功: ${roomIds.length} 个房间 (${start}-${end})`);
        loadRooms();
      }
    } catch (err) {
      setMessage(`❌ 批量入住失败: ${err}`);
    }
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
      <div className="flex-1 flex overflow-hidden">
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
                type="range"
                min="16"
                max="30"
                value={targetTemp}
                onChange={(e) => setTargetTemp(Number(e.target.value))}
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

          {/* 批量入住 */}
          <div className="bg-[#252526] rounded p-4 space-y-3">
            <h3 className="text-sm font-medium mb-2">批量入住</h3>
            
            {/* 快捷批量按钮 */}
            <div className="space-y-2">
              <label className="text-xs text-[#858585]">快捷批量入住</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleQuickBatchCheckin(1, 10)}
                  className="bg-[#3e3e42] hover:bg-[#505050] px-3 py-2 rounded text-xs"
                >
                  1-10
                </button>
                <button
                  onClick={() => handleQuickBatchCheckin(11, 20)}
                  className="bg-[#3e3e42] hover:bg-[#505050] px-3 py-2 rounded text-xs"
                >
                  11-20
                </button>
                <button
                  onClick={() => handleQuickBatchCheckin(1, 50)}
                  className="bg-[#3e3e42] hover:bg-[#505050] px-3 py-2 rounded text-xs"
                >
                  1-50
                </button>
                <button
                  onClick={() => handleQuickBatchCheckin(1, 100)}
                  className="bg-[#0e639c] hover:bg-[#1177bb] px-3 py-2 rounded text-xs"
                >
                  全部100间
                </button>
              </div>
            </div>

            {/* 自定义批量 */}
            <div className="space-y-2 pt-2 border-t border-[#3e3e42]">
              <label className="text-xs text-[#858585]">自定义房间号</label>
              <textarea
                placeholder="输入房间号，用逗号或空格分隔，例如: 1, 2, 3"
                value={batchRoomIds}
                onChange={(e) => setBatchRoomIds(e.target.value)}
                className="w-full h-16 bg-[#3c3c3c] border border-[#3e3e42] rounded px-2 py-1 text-xs"
              />
              <button
                onClick={handleBatchCheckin}
                className="w-full bg-[#0e639c] hover:bg-[#1177bb] px-3 py-2 rounded text-xs"
              >
                批量入住
              </button>
            </div>
          </div>

          {/* 快捷入住 */}
          <div className="bg-[#252526] rounded p-4 space-y-3">
            <h3 className="text-sm font-medium mb-2">快捷入住</h3>
            <input
              type="text"
              placeholder="客户姓名（可选）"
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
              className="w-full bg-[#3c3c3c] border border-[#3e3e42] rounded px-2 py-1 text-xs"
            />
            <button
              onClick={handleQuickCheckin}
              className="w-full bg-[#0e639c] hover:bg-[#1177bb] px-3 py-2 rounded text-xs"
              disabled={!selectedRoomId}
            >
              一键入住
            </button>
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
        <div className="w-80 bg-[#252526] border-l border-[#3e3e42] p-4 space-y-4 overflow-y-auto">
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
    </div>
  );
}
