import { http } from "./client";

export interface SetTemperaturePayload {
  roomId: string;
  temperature: number;
}

export interface SetFeePayload {
  roomId: string;
  currentFee?: number;
  totalFee?: number;
}

export interface BatchCheckinPayload {
  roomIds: string[];
}

export const debugClient = {
  async setTemperature(payload: SetTemperaturePayload) {
    return http("/debug/set-temperature", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async setFee(payload: SetFeePayload) {
    return http("/debug/set-fee", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async batchCheckin(payload: BatchCheckinPayload) {
    return http("/debug/batch-checkin", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async globalPowerOn() {
    return http("/ac/global/power-on", {
      method: "POST",
    });
  },
};
