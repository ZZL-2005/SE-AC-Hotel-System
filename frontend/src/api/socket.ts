/**
 * Socket.IO 客户端模块 - 管理与后端的 WebSocket 长连接
 */
import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "./client";

let socket: Socket | null = null;

/**
 * 获取 Socket.IO 实例（单例模式）
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    socket.on("connect", () => {
      console.log("[Socket.IO] Connected:", socket?.id);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket.IO] Disconnected:", reason);
    });

    socket.on("connect_error", (error) => {
      console.error("[Socket.IO] Connection error:", error);
    });
  }
  return socket;
}

/**
 * 订阅特定房间的状态更新
 */
export function subscribeRoom(roomId: string): void {
  getSocket().emit("subscribe_room", { roomId });
}

/**
 * 订阅监控面板的全局更新
 */
export function subscribeMonitor(): void {
  getSocket().emit("subscribe_monitor", {});
}

/**
 * 取消订阅监控面板
 */
export function unsubscribeMonitor(): void {
  getSocket().emit("unsubscribe_monitor", {});
}

/**
 * 断开 Socket.IO 连接
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
