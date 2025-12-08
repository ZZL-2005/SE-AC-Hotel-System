import { http } from "./client";

export interface CreateRoomPayload {
  roomId: string;
  initialTemp: number;
  ratePerNight: number;
}

export interface CreateRoomResponse {
  roomId: string;
  initialTemp: number;
  ratePerNight: number;
  status: string;
}

export interface HyperParamSettings {
  maxConcurrent: number;
  timeSliceSeconds: number;
  changeTempMs: number;
  autoRestartThreshold: number;
  idleDriftPerMin: number;
  midDeltaPerMin: number;
  highMultiplier: number;
  lowMultiplier: number;
  defaultTarget: number;
  pricePerUnit: number;
  rateHighUnitPerMin: number;
  rateMidUnitPerMin: number;
  rateLowUnitPerMin: number;
  ratePerNight: number;
  clockRatio: number;
}

export type HyperParamUpdatePayload = Partial<HyperParamSettings>;

export const adminClient = {
  async createRoom(payload: CreateRoomPayload) {
    return http<CreateRoomResponse>("/monitor/rooms/open", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async getHyperParams() {
    return http<HyperParamSettings>("/monitor/hyperparams");
  },
  async updateHyperParams(payload: HyperParamUpdatePayload) {
    return http<HyperParamSettings>("/monitor/hyperparams", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
