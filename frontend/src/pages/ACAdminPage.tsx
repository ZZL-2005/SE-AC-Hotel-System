import { MonitorPage } from "./MonitorPage";

export function ACAdminPage() {
  // 监控页本身已包含房间、队列、参数、日志等模块；此页保持轻量，避免嵌套滚动导致排版挤压。
  return <MonitorPage />;
}
