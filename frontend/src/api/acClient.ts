import { http, type ApiResult } from "./client";

export type RoomStateResponse = {
  roomId: string;
  status: string;
  currentTemp?: number;
  targetTemp?: number;
  speed?: string;
  currentFee?: number;
  totalFee?: number;
  isServing?: boolean;
  isWaiting?: boolean;
  mode?: string;
};

export const acClient = {
  powerOn(roomId: string, payload: Record<string, unknown>): Promise<ApiResult<RoomStateResponse>> {
    return http<RoomStateResponse>(`/rooms/${roomId}/ac/power-on`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  changeTemp(roomId: string, targetTemp: number): Promise<ApiResult<RoomStateResponse>> {
    return http<RoomStateResponse>(`/rooms/${roomId}/ac/change-temp`, {
      method: "POST",
      body: JSON.stringify({ targetTemp }),
    });
  },
  changeSpeed(roomId: string, speed: string): Promise<ApiResult<RoomStateResponse>> {
    return http<RoomStateResponse>(`/rooms/${roomId}/ac/change-speed`, {
      method: "POST",
      body: JSON.stringify({ speed }),
    });
  },
  powerOff(roomId: string): Promise<ApiResult<RoomStateResponse>> {
    return http<RoomStateResponse>(`/rooms/${roomId}/ac/power-off`, { method: "POST" });
  },
  fetchState(roomId: string): Promise<ApiResult<RoomStateResponse>> {
    return http<RoomStateResponse>(`/rooms/${roomId}/ac/state`);
  },
};
