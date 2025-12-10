import { useState } from "react";
import { MonitorPage } from "./MonitorPage";
import { adminClient } from "../api/adminClient";

export function ACAdminPage() {
  const [globalPowerLoading, setGlobalPowerLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleGlobalPowerOn = async () => {
    setGlobalPowerLoading(true);
    setMessage(null);
    try {
      // 调用全局开机 API（需要后端实现）
      // TODO: 实现批量开机功能
      setMessage({ type: "success", text: "全局开机功能演示（实际功能待实现）" });
    } catch (err) {
      setMessage({ type: "error", text: "操作失败" });
    } finally {
      setGlobalPowerLoading(false);
    }
  };

  return (
    <div className="relative">
      {/* 全局控制按钮（悬浮在右下角） */}
      <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-3">
        {message && (
          <div
            className={`rounded-xl px-4 py-2 text-sm shadow-lg ${
              message.type === "success"
                ? "bg-[#34c759] text-white"
                : "bg-[#ff3b30] text-white"
            }`}
          >
            {message.text}
          </div>
        )}
        
        <button
          onClick={handleGlobalPowerOn}
          disabled={globalPowerLoading}
          className="rounded-xl bg-[#0071e3] px-6 py-3 text-sm font-medium text-white shadow-lg transition-all hover:bg-[#0077ed] active:scale-95 disabled:opacity-50"
        >
          {globalPowerLoading ? "处理中..." : "🌐 全局开机"}
        </button>
      </div>

      {/* 复用监控页面 */}
      <MonitorPage />
    </div>
  );
}
