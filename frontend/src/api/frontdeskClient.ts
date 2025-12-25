import { http, type ApiResult } from "./client";

// 对应 SSD 系统事件：
// 1. Registe_CustomerInfo(Cust_Id, Cust_name, number, date)
// 2. Check_RoomState(date)
// 3. Create_Accommodation_Order(Customer_id, Room_id)
// 4. deposite(amount) - 可选
export type CheckInPayload = {
  custId: string;        // Cust_Id - 身份证号
  custName: string;      // Cust_name - 顾客姓名
  guestCount: number;    // number - 入住人数
  checkInDate: string;   // date - 入住日期
  roomId: string;        // Room_id - 房间号
  deposit: number;       // amount - 押金（可选）
};

export type CheckInResponse = {
  orderId: string;
  roomId: string;
  custId: string;
  custName: string;
  guestCount: number;
  checkInDate: string;
  deposit: number;
  initialTemp: number;
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
    accommodationSeconds?: number;
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
    logicStartSeconds: number | null;
    logicEndSeconds: number | null;
    durationSeconds: number | null;
    ratePerMin: number;
    feeValue: number;
  }>;
  mealBill: {
    totalFee: number;
    orders: Array<{
      orderId: string;
      items: Array<{ id: string; name: string; price: number; qty: number }>;
      totalFee: number;
      note: string | null;
      createdAt: string | null;
    }>;
  } | null;
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
  mealBill: CheckOutResponse["mealBill"];
};

export type MealOrderPayload = {
  items: Array<{ id: string; name: string; price: number; qty: number }>;
  note?: string;
};

export type MealOrderResponse = {
  orderId: string;
  roomId: string;
  items: Array<{ id: string; name: string; price: number; qty: number }>;
  totalFee: number;
  note: string | null;
  createdAt: string;
};

export type MealOrdersResponse = {
  roomId: string;
  orders: Array<{
    orderId: string;
    items: Array<{ id: string; name: string; price: number; qty: number }>;
    totalFee: number;
    note: string | null;
    createdAt: string | null;
  }>;
  totalFee: number;
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
  createMealOrder(roomId: string, payload: MealOrderPayload): Promise<ApiResult<MealOrderResponse>> {
    return http<MealOrderResponse>(`/rooms/${roomId}/meals`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  fetchMealOrders(roomId: string): Promise<ApiResult<MealOrdersResponse>> {
    return http<MealOrdersResponse>(`/rooms/${roomId}/meals`);
  },
};
