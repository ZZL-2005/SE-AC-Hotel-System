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
  
  // 批量选择状态
  const [lastClickedRoom, setLastClickedRoom] = useState<string | null>(null);
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  
  // 空调控制状态
  const [targetTemp, setTargetTemp] = useState(24);
  const [speed, setSpeed] = useState("MID");
  const [isEditingTemp, setIsEditingTemp] = useState(false); // 标记是否正在编辑温度
  

  
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
          // 只有在不是正在编辑温度时才更新滑动条值
          if (!isEditingTemp) {
            setTargetTemp(room.targetTemp || 24);
          }
        }
      }
    }
  }, [selectedRoomId, isEditingTemp]);

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

  const handleRoomSelect = (roomId: string, event?: React.MouseEvent) => {
    // Shift 批量选择
    if (event?.shiftKey && lastClickedRoom) {
      const allRoomIds = allRooms.map(r => r.roomId);
      const startIdx = allRoomIds.indexOf(lastClickedRoom);
      const endIdx = allRoomIds.indexOf(roomId);
      
      const start = Math.min(startIdx, endIdx);
      const end = Math.max(startIdx, endIdx);
      
      const newSelected = new Set(selectedRooms);
      for (let i = start; i <= end; i++) {
        newSelected.add(allRoomIds[i]);
      }
      setSelectedRooms(newSelected);
    } else {
      // 普通选择
      setSelectedRoomId(roomId);
      setLastClickedRoom(roomId);
      setSelectedRooms(new Set([roomId]));
      
      const room = rooms.find(r => r.roomId === roomId);
      if (room) {
        setSelectedRoom(room);
        setTargetTemp(room.targetTemp || 24);
        setIsEditingTemp(false); // 切换房间时重置编辑状态
      }
    }
  };

  // 右键快捷入住
  const handleRoomContextMenu = async (roomId: string, event: React.MouseEvent) => {
    event.preventDefault();
    
    const room = allRooms.find(r => r.roomId === roomId);
    if (room?.status === 'occupied') {
      setMessage("⚠️ 该房间已入住");
      return;
    }
    
    try {
      const { error } = await frontdeskClient.checkIn({
        custId: `DBG${Date.now()}`,
        custName: "调试用户",
        guestCount: 1,
        checkInDate: new Date().toISOString(),
        roomId: roomId,
        deposit: 0,
      });
      
      if (error) {
        setMessage(`❌ ${error}`);
      } else {
        setMessage(`✅ 房间 ${roomId} 快捷入住成功`);
        loadRooms();
      }
    } catch (err) {
      setMessage(`❌ 入住失败: ${err}`);
    }
  };

  // 批量入住选中的房间
  const handleBatchCheckinSelected = async () => {
    if (selectedRooms.size === 0) {
      setMessage("❌ 请先选择房间（按住 Shift 可批量选择）");
      return;
    }
    
    const roomIds = Array.from(selectedRooms);
    try {
      const { error } = await debugClient.batchCheckin({ roomIds });
      if (error) {
        setMessage(`❌ ${error}`);
      } else {
        setMessage(`✅ 批量入住成功: ${roomIds.length} 个房间`);
        setSelectedRooms(new Set());
        loadRooms();
      }
    } catch (err) {
      setMessage(`❌ 批量入住失败: ${err}`);
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
    setIsEditingTemp(false); // 提交后重置编辑状态
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

  return (
    <div className="h-screen bg-gradient-to-br from-[#f5f5f7] to-[#e8e8ed] text-gray-800 flex flex-col">
      {/* 顶部栏 - 苹果风格 */}
      <div className="bg-white/80 backdrop-blur-xl px-6 py-4 flex items-center justify-between border-b border-gray-200/50 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="text-2xl">🛠️</span>
          <h1 className="text-lg font-semibold text-gray-900">调试管理员</h1>
          {selectedRoomId && (
            <span className="text-sm text-gray-500">
              当前房间: <span className="text-blue-600 font-medium">{selectedRoomId}</span>
            </span>
          )}
        </div>
        {message && (
          <div className="text-sm bg-gray-100 text-gray-700 px-4 py-2 rounded-full shadow-sm">{message}</div>
        )}
      </div>

      {/* 主内容区 - 三栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：房间选择器 */}
        <div className="w-72 bg-white/60 backdrop-blur-xl border-r border-gray-200/50 flex flex-col">
          <div className="px-4 py-3 text-sm font-semibold border-b border-gray-200/50 flex items-center justify-between">
            <span className="text-gray-700">全部房间</span>
            <span className="text-gray-400">{allRooms.filter(r => r.status === 'occupied').length}/100</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {allRooms.map((room) => {
              const occupiedRoom = rooms.find(r => r.roomId === room.roomId);
              const isOccupied = room.status === 'occupied';
              
              const isSelected = selectedRooms.has(room.roomId);
              
              return (
                <button
                  key={room.roomId}
                  onClick={(e) => handleRoomSelect(room.roomId, e)}
                  onContextMenu={(e) => handleRoomContextMenu(room.roomId, e)}
                  className={`w-full px-4 py-2.5 mb-1 text-left text-sm flex items-center justify-between rounded-lg transition-all duration-200 ${
                    selectedRoomId === room.roomId ? "bg-blue-500 text-white shadow-md" : isSelected ? "bg-blue-100 text-blue-900" : "hover:bg-gray-100"
                  } ${
                    !isOccupied ? "opacity-50" : ""
                  }`}
                  title={isOccupied ? "左键选择 | 右键快捷入住" : "右键快捷入住"}
                >
                  <span className="flex items-center gap-2 font-medium">
                    {isSelected && <span className={selectedRoomId === room.roomId ? "text-white" : "text-blue-600"}>▸</span>}
                    {room.roomId}
                  </span>
                  {isOccupied && occupiedRoom ? (
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        occupiedRoom.isServing ? "bg-green-500" : occupiedRoom.isWaiting ? "bg-orange-500" : "bg-gray-400"
                      }`}
                    />
                  ) : (
                    <span className={`text-xs ${
                      selectedRoomId === room.roomId ? "text-blue-200" : "text-gray-400"
                    }`}>未入住</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 中间：控制面板 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 空调控制 */}
          <div className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 space-y-4 shadow-lg">
            <h3 className="text-base font-semibold text-gray-900 mb-3">空调控制</h3>
            <div className="flex gap-3">
              <button
                onClick={handlePowerOn}
                className="flex-1 bg-blue-500 hover:bg-blue-600 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!selectedRoomId}
              >
                开机
              </button>
              <button
                onClick={handlePowerOff}
                className="flex-1 bg-gray-200 hover:bg-gray-300 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!selectedRoomId}
              >
                关机
              </button>
            </div>
            <div className="space-y-3">
              <label className="text-sm text-gray-600 font-medium">目标温度: <span className="text-blue-600 text-lg">{targetTemp}°C</span></label>
              <input
                type="range"
                min="16"
                max="30"
                value={targetTemp}
                onChange={(e) => {
                  setTargetTemp(Number(e.target.value));
                  setIsEditingTemp(true); // 开始编辑时标记
                }}
                className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:shadow-md"
              />
              <button
                onClick={handleChangeTemp}
                className="w-full bg-blue-500 hover:bg-blue-600 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!selectedRoomId}
              >
                调节温度
              </button>
            </div>
            <div className="space-y-3">
              <label className="text-sm text-gray-600 font-medium">风速</label>
              <select
                value={speed}
                onChange={(e) => setSpeed(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="HIGH">高风</option>
                <option value="MID">中风</option>
                <option value="LOW">低风</option>
              </select>
              <button
                onClick={handleChangeSpeed}
                className="w-full bg-blue-500 hover:bg-blue-600 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!selectedRoomId}
              >
                调节风速
              </button>
            </div>
          </div>

          {/* 批量操作 */}
          <div className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 space-y-4 shadow-lg">
            <h3 className="text-base font-semibold text-gray-900 mb-3">批量操作</h3>
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 space-y-3">
              <div className="text-sm text-gray-600">
                <p className="font-medium text-gray-700 mb-2">💡 提示：</p>
                <p>• 右键房间 → 快捷入住</p>
                <p>• 按住 Shift → 批量选择</p>
                <p>• 左键 → 单选房间</p>
              </div>
              <div className="pt-3 border-t border-blue-200">
                <p className="text-sm text-gray-600 mb-1">已选择: <span className="font-semibold text-blue-600">{selectedRooms.size}</span> 个房间</p>
                {selectedRooms.size > 0 && (
                  <p className="text-xs text-blue-700 font-mono bg-blue-100/50 px-2 py-1 rounded-lg mt-1">房间号: {Array.from(selectedRooms).sort((a, b) => Number(a) - Number(b)).join(', ')}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleBatchCheckinSelected}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 px-4 py-3 rounded-xl text-sm font-medium text-white transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={selectedRooms.size === 0}
            >
              批量入住选中房间 ({selectedRooms.size})
            </button>
          </div>

          {/* 危险区域：直接调节 */}
          <div className="bg-gradient-to-br from-red-50 to-orange-50 border-2 border-red-200 rounded-2xl p-6 space-y-4 shadow-lg">
            <h3 className="text-base font-semibold mb-3 text-red-600">⚠️ 危险操作</h3>
            <div className="space-y-3">
              <label className="text-sm text-gray-700 font-medium">直接设置温度</label>
              <div className="flex gap-3">
                <input
                  type="number"
                  placeholder="温度 (°C)"
                  value={manualTemp}
                  onChange={(e) => setManualTemp(e.target.value)}
                  className="flex-1 bg-white border border-red-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
                  step="0.1"
                />
                <button
                  onClick={handleSetTemperature}
                  className="bg-red-500 hover:bg-red-600 px-5 py-3 rounded-xl text-sm font-medium text-white transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selectedRoomId || !manualTemp}
                >
                  设置
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-sm text-gray-700 font-medium">直接设置费用</label>
              <div className="flex gap-3">
                <input
                  type="number"
                  placeholder="费用 (¥)"
                  value={manualFee}
                  onChange={(e) => setManualFee(e.target.value)}
                  className="flex-1 bg-white border border-red-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
                  step="0.01"
                />
                <button
                  onClick={handleSetFee}
                  className="bg-red-500 hover:bg-red-600 px-5 py-3 rounded-xl text-sm font-medium text-white transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selectedRoomId || !manualFee}
                >
                  设置
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：状态监控 */}
        <div className="w-80 bg-white/60 backdrop-blur-xl border-l border-gray-200/50 p-6 space-y-4 overflow-y-auto">
          {selectedRoom && (
            <>
              <div className="bg-white/80 backdrop-blur-xl rounded-2xl p-5 space-y-3 shadow-lg">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">房间状态</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                    <span className="text-gray-600">房间号</span>
                    <span className="text-blue-600 font-semibold text-lg">{selectedRoom.roomId}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">当前温度</span>
                    <span className="text-orange-600 font-semibold text-lg">{selectedRoom.currentTemp.toFixed(1)}°C</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">目标温度</span>
                    <span className="font-medium text-gray-800">{selectedRoom.targetTemp.toFixed(1)}°C</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">风速</span>
                    <span className="font-medium text-gray-800">{selectedRoom.speed || "—"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">服务状态</span>
                    <span className={`font-medium ${
                      selectedRoom.isServing ? "text-green-600" : selectedRoom.isWaiting ? "text-orange-500" : "text-gray-500"
                    }`}>
                      {selectedRoom.isServing ? "服务中" : selectedRoom.isWaiting ? "等待中" : "空闲"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                    <span className="text-gray-600">本次费用</span>
                    <span className="text-indigo-600 font-semibold">¥{selectedRoom.currentFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">累计费用</span>
                    <span className="text-indigo-600 font-semibold text-lg">¥{selectedRoom.totalFee.toFixed(2)}</span>
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
