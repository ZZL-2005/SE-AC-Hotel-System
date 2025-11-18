import { http, type ApiResult } from "./client";

export type CheckInPayload = {
  customerName: string;
  roomId: string;
  nights: number;
  deposit: number;
};

export type CheckInResponse = {
  orderId: string;
  roomId: string;
  initialTemp: number;
  nights: number;
  deposit: number;
  status: string;
};

export type CheckOutResponse = {
  roomId: string;
  accommodationBill: {
    billId: string;
    roomFee: number;
    nights: number;
    ratePerNight: number;
    deposit: number;
  };
  acBill: {
    billId: string;
    roomId: string;
    periodStart: string;
    periodEnd: string;
    totalFee: number;
  } | null;
  detailRecords: Array<{
    recordId: string;
    roomId: string;
    speed: string;
    startedAt: string;
    endedAt: string | null;
    ratePerMin: number;
    feeValue: number;
  }>;
  totalDue: number;
};

export type BillsResponse = {
  roomId: string;
  accommodationBill: {
    billId: string;
    roomId: string;
    totalFee: number;
    createdAt: string;
  } | null;
  acBill: CheckOutResponse["acBill"];
  detailRecords: CheckOutResponse["detailRecords"];
};

export const frontdeskClient = {
  checkIn(payload: CheckInPayload): Promise<ApiResult<CheckInResponse>> {
    return http<CheckInResponse>(`/checkin`, { method: "POST", body: JSON.stringify(payload) });
  },
  checkOut(roomId: string): Promise<ApiResult<CheckOutResponse>> {
    return http<CheckOutResponse>(`/checkout`, {
      method: "POST",
      body: JSON.stringify({ roomId }),
    });
  },
  fetchBills(roomId: string): Promise<ApiResult<BillsResponse>> {
    return http<BillsResponse>(`/rooms/${roomId}/bills`);
  },
};
