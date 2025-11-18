import { http, type ApiResult } from "./client";
import type { RoomStatus } from "../types/rooms";

type MonitorResponse = {
  rooms: RoomStatus[];
};

export const monitorClient = {
  fetchRooms(): Promise<ApiResult<MonitorResponse>> {
    return http<MonitorResponse>(`/monitor/rooms`);
  },
};
