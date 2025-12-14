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

export interface SystemStatus {
  paused: boolean;
  tick: number;
  tickInterval: number;
  timerStats: {
    totalTimers: number;
    byType: Record<string, number>;
    tickInterval: number;
    tickCounter: number;
    pendingEvents: number;
  };
}

export interface TimerDetail {
  timer_id: string;
  type: string;
  room_id: string;
  speed: string | null;
  elapsed: number;
  remaining: number;
  fee: number;
  active: boolean;
}

export interface QueueStatus {
  serviceQueue: Array<{
    roomId: string;
    speed: string;
    status: string;
    servedSeconds: number;
    priorityToken: number;
    timeSliceEnforced: boolean;
    timerId: string;
  }>;
  waitingQueue: Array<{
    roomId: string;
    speed: string;
    status: string;
    waitedSeconds: number;
    priorityToken: number;
    timeSliceEnforced: boolean;
    timerId: string;
  }>;
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

  async pauseSystem() {
    return http("/debug/system/pause", {
      method: "POST",
    });
  },

  async resumeSystem() {
    return http("/debug/system/resume", {
      method: "POST",
    });
  },

  async getSystemStatus() {
    return http<SystemStatus>("/debug/system/status", {
      method: "GET",
    });
  },

  async getTimerDetails() {
    return http<{ timers: TimerDetail[] }>("/monitor/timers", {
      method: "GET",
    });
  },

  async getQueueStatus() {
    return http<QueueStatus>("/monitor/queues", {
      method: "GET",
    });
  },
};
