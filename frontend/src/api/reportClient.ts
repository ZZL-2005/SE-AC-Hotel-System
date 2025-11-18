import { http, type ApiResult } from "./client";

export type TrendPoint = { time: string; fee: number; kwh: number };
export type RoomBreakdown = {
  roomId: string;
  minutes: number;
  highCount: number;
  midCount: number;
  lowCount: number;
  kwh: number;
  fee: number;
};
export type HourlySpeedPoint = { hour: string; high: number; mid: number; low: number };

export type ReportResponse = {
  summary: {
    totalRevenue: number;
    acRevenue: number;
    roomRevenue: number;
    totalKwh: number;
  };
  trend: TrendPoint[];
  speedRate: { high: number; mid: number; low: number };
  rooms: RoomBreakdown[];
  hourlySpeed: HourlySpeedPoint[];
  kpi: {
    avgKwh: number;
    avgFee: number;
    peakHour: string | null;
    highRate: number;
    avgSession: number;
  };
};

export const reportClient = {
  fetchReport(from: string, to: string): Promise<ApiResult<ReportResponse>> {
    const query = new URLSearchParams({ from, to }).toString();
    return http<ReportResponse>(`/report?${query}`);
  },
};
